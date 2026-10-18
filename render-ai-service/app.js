'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const pino = require('pino');
const { verifyHmac } = require('./middleware/hmac');

// Structured logger with reportId child binding support
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
});

const app = express();
const PORT = process.env.PORT || 3000;

// R2 S3-compatible client (lazy-initialized)
let r2Client = null;
function getR2Client() {
  if (!r2Client) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error('R2 credentials not configured');
    }
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return r2Client;
}

// Middleware: capture raw body for HMAC verification
app.use(cors());
app.use(bodyParser.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));

// Health check (no HMAC required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Moderate endpoint (HMAC protected)
/** Maximum allowed age of incoming webhook timestamp in milliseconds (5 minutes). */
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

app.post('/moderate', verifyHmac, async (req, res) => {
  const { reportId, title, description, category, imageKey, authorId, timestamp } = req.body;
  const log = logger.child({ reportId });

  // Validate required fields
  if (!reportId || !title || !description || !category) {
    log.warn({ body: req.body }, 'Missing required fields in moderation request');
    return res.status(400).json({ error: 'Missing required fields: reportId, title, description, category' });
  }

  // Replay-window protection: reject payloads older than 5 minutes
  if (timestamp) {
    const payloadAge = Date.now() - new Date(timestamp).getTime();
    if (payloadAge > REPLAY_WINDOW_MS) {
      log.warn({ timestamp, ageMs: payloadAge }, 'Replay window exceeded');
      return res.status(400).json({ error: 'Payload too old' });
    }
  }

  log.info({ category, hasImage: !!imageKey, authorId, timestamp }, 'Received moderation request');

  try {
    const moderationResult = await moderateReport({ title, description, category, imageKey, authorId, timestamp }, log);
    log.info({ verdict: moderationResult.verdict, confidence: moderationResult.confidence, needsManualReview: moderationResult.needsManualReview }, 'Moderation complete');

    // Fire-and-forget callback to Worker (don't block response)
    sendModerationResult({ reportId, ...moderationResult, timestamp: new Date().toISOString() }, log).catch((err) => {
      log.error({ err }, 'Failed to send moderation result to Worker');
    });

    res.json({ success: true, message: 'Moderation processed', reportId });
  } catch (error) {
    log.error({ err: error }, 'Error in moderation pipeline');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Core moderation logic using Gemini AI.
 */
async function moderateReport({ title, description, category, imageKey }, log) {
  const MODERATION_PROMPT = `You are a road-incident report moderator for the RoadMap system in Bataan, Philippines.
Evaluate whether this report is a legitimate road hazard, traffic violation, or infrastructure issue.

Valid categories: Flooded Road, Road Construction, Road Closure, Damaged Road, Heavy Traffic, Fallen Debris, Road Accident (Self), Road Accident (Vehicular), Others.

Rules:
- APPROVE if the report describes a plausible road incident with sufficient detail.
- REJECT if the report is spam, off-topic, contains inappropriate content, lacks meaningful description, or is clearly fraudulent.
- If an image is provided, verify it shows a road-related scene consistent with the description. Reject if the image is unrelated, blank, or inappropriate.
- Be lenient toward approval when uncertain; human reviewers can correct mistakes.

Respond with ONLY valid JSON (no markdown fences):
{
  "verdict": "approve" | "reject",
  "confidence": <number 0.0 to 1.0>,
  "reason": "<brief explanation, max 300 chars>",
  "needsManualReview": <boolean — true if you are unsure or confidence is below 0.80>
}`;

  // Fallback if no API key
  if (!process.env.GEMINI_API_KEY) {
    log.warn('GEMINI_API_KEY not set, returning fallback');
    return { verdict: 'approve', confidence: 0.75, reason: 'Fallback: no AI key configured', needsManualReview: true };
  }

  let ai;
  try {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  } catch (err) {
    log.error({ err }, 'Failed to initialize Gemini');
    return { verdict: 'approve', confidence: 0.75, reason: 'Fallback: Gemini initialization failed', needsManualReview: true };
  }

  const parts = [{ text: MODERATION_PROMPT }];
  parts.push({ text: `Title: ${title}\nCategory: ${category}\nDescription: ${description}` });

  // Fetch and attach user-uploaded image from R2 if present
  if (imageKey) {
    try {
      const client = getR2Client();
      const bucket = process.env.R2_BUCKET_NAME || 'road-map-media';
      const command = new GetObjectCommand({ Bucket: bucket, Key: imageKey });
      const response = await client.send(command);
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const base64 = buffer.toString('base64');
      const mimeType = response.ContentType || 'image/jpeg';
      parts.push({ inlineData: { mimeType, data: base64 } });
      log.info({ imageKey, size: buffer.length }, 'Attached image from R2');
    } catch (err) {
      log.warn({ err, imageKey }, 'Failed to fetch image from R2, proceeding without image');
    }
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: [{ role: 'user', parts }],
    });

    const text = response.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter((t) => typeof t === 'string')
      .join('')
      .trim();

    if (!text) {
      log.warn('Empty response from Gemini');
      return { verdict: 'approve', confidence: 0.65, reason: 'Fallback: empty AI response', needsManualReview: true };
    }

    // Strip markdown fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    const verdict = parsed.verdict === 'reject' ? 'reject' : 'approve';
    const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0));
    const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : 'No reason provided.';
    const needsManualReview = parsed.needsManualReview === true || confidence < 0.80;

    return { verdict, confidence, reason, needsManualReview };
  } catch (err) {
    log.error({ err }, 'Gemini API error');
    return { verdict: 'approve', confidence: 0.65, reason: `Fallback: AI error - ${err?.message || 'unknown'}`, needsManualReview: true };
  }
}

/**
 * Send signed moderation result back to Cloudflare Worker webhook.
 * Includes retry logic with exponential backoff.
 */
async function sendModerationResult(payload, log, maxRetries = 2) {
  const webhookUrl = process.env.WORKER_WEBHOOK_URL;
  const secret = process.env.AI_WEBHOOK_SECRET;

  if (!webhookUrl) {
    log.warn('WORKER_WEBHOOK_URL not configured, skipping callback');
    return { status: 'skipped', reason: 'no webhook URL' };
  }
  if (!secret) {
    log.warn('AI_WEBHOOK_SECRET not configured, cannot sign callback');
    return { status: 'skipped', reason: 'no secret' };
  }

  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-signature': signature,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        log.info({ attempt, statusCode: response.status }, 'Webhook callback succeeded');
        return { status: 'success', statusCode: response.status };
      }

      log.warn({ attempt, statusCode: response.status, statusText: response.statusText }, 'Webhook callback returned non-OK status');
    } catch (err) {
      log.warn({ attempt, err: err.message }, 'Webhook callback failed');
    }

    // Exponential backoff before retry
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 1000;
      log.info({ delay }, 'Retrying webhook callback');
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  log.error({ maxRetries }, 'Webhook callback exhausted all retries');
  return { status: 'failed', reason: 'max retries exceeded' };
}

// Start server
app.listen(PORT, () => {
  logger.info({ port: PORT }, 'AI moderation service started');
});
