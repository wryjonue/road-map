require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Moderate endpoint
app.post('/moderate', async (req, res) => {
  try {
    const { reportId, title, description, category, imageKey, authorId, timestamp } = req.body;
    
    // Validate required fields
    if (!reportId || !title || !description || !category) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    console.log(`[render] Received moderation request for report ${reportId}`);
    
    // Validate webhook signature (simplified for now)
    const signature = req.headers['x-webhook-signature'];
    if (!signature) {
      console.warn('[render] Missing webhook signature');
      // In production, this should return 401
    }
    
    // Process moderation with Gemini
    const moderationResult = await moderateReport({
      title,
      description,
      category,
      imageKey,
      authorId,
      timestamp
    });
    
    console.log(`[render] Moderation result for report ${reportId}:`, moderationResult);
    
    // Send result back to Worker
    const workerResponse = await sendModerationResult(moderationResult);
    
    res.json({ 
      success: true, 
      message: 'Moderation processed',
      reportId,
      workerResponse
    });
    
  } catch (error) {
    console.error('[render] Error in moderation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper functions
async function moderateReport({ title, description, category, imageKey, authorId, timestamp }) {
  console.log('[render] Moderating report:', { title, category, hasImage: !!imageKey });
  
  // Use same logic as current ai-service.js but in Render context
  const MODERATION_PROMPT = `You are a road-incident report moderator for the RoadMap system in Bataan, Philippines.\nEvaluate whether this report is a legitimate road hazard, traffic violation, or infrastructure issue.\n\nValid categories: Flooded Road, Road Construction, Road Closure, Damaged Road, Heavy Traffic, Fallen Debris, Road Accident (Self), Road Accident (Vehicular), Others.\n\nRules:\n- APPROVE if the report describes a plausible road incident with sufficient detail.\n- REJECT if the report is spam, off-topic, contains inappropriate content, lacks meaningful description, or is clearly fraudulent.\n- If an image is provided, verify it shows a road-related scene consistent with the description. Reject if the image is unrelated, blank, or inappropriate.\n- Be lenient toward approval when uncertain; human reviewers can correct mistakes.\n\nRespond with ONLY valid JSON (no markdown fences):\n{\n  "verdict": "approve" | "reject",\n  "confidence": <number 0.0 to 1.0>,\n  "reason": "<brief explanation, max 300 chars>",\n  "needsManualReview": <boolean — true if you are unsure or confidence is below 0.80>\n}`;

  if (!process.env.GEMINI_API_KEY) {
    console.error('[render] GEMINI_API_KEY not set');
    return {
      verdict: 'approve',
      confidence: 0.75,
      reason: 'Fallback: no AI key configured',
      needsManualReview: true
    };
  }

  let ai;
  try {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  } catch (err) {
    console.error('[render] failed to initialize Gemini:', String(err));
    return {
      verdict: 'approve',
      confidence: 0.75,
      reason: 'Fallback: Gemini initialization failed',
      needsManualReview: true
    };
  }

  const parts = [{ text: MODERATION_PROMPT }];
  parts.push({ text: `Title: ${title}\nCategory: ${category}\nDescription: ${description}` });

  // Attach user-uploaded image if present (not the static map).
  if (imageKey) {
    try {
      // In Render, we'd need to fetch from R2 using AWS SDK or similar
      // For now, simulate with placeholder
      console.log('[render] Image processing not implemented yet - would fetch from R2');
    } catch (err) {
      console.error('[render] failed to read image:', String(err));
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
      console.error('[render] empty response from Gemini');
      return {
        verdict: 'approve',
        confidence: 0.65,
        reason: 'Fallback: empty AI response',
        needsManualReview: true
      };
    }

    // Strip markdown fences if present.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    const verdict = parsed.verdict === 'reject' ? 'reject' : 'approve';
    const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0));
    const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : 'No reason provided.';
    const needsManualReview = parsed.needsManualReview === true || confidence < 0.80;

    return { verdict, confidence, reason, needsManualReview };
  } catch (err) {
    console.error('[render] error:', err?.message || String(err));
    return {
      verdict: 'approve',
      confidence: 0.65,
      reason: 'Fallback: AI error - ' + (err?.message || 'unknown'),
      needsManualReview: true
    };
  }
}

async function sendModerationResult(result) {
  // In production, this would call the Worker webhook
  console.log('[render] Sending moderation result to Worker:', result);
  
  // For development, we'll simulate with console log
  // In real implementation, use axios or node-fetch to POST to WORKER_WEBHOOK_URL
  return { status: 'simulated' };
}

// Start server
app.listen(PORT, () => {
  console.log(`[render] AI moderation service running on port ${PORT}`);
});