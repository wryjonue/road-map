#!/usr/bin/env node
/**
 * Integration test script for AI moderation webhook flow.
 *
 * Usage:
 *   node scripts/test-ai-moderation.mjs                          # dry-run (no DB writes)
 *   node scripts/test-ai-moderation.mjs --execute                # actually send webhooks
 *
 * Environment variables (or .env in project root):
 *   WORKER_URL           - Cloudflare Worker base URL (e.g. https://road-map.example.com)
 *   RENDER_SERVICE_URL   - Render AI service /moderate URL
 *   AI_WEBHOOK_SECRET    - Shared HMAC secret (must match both services)
 *   TEST_REPORT_ID       - Optional: specific report ID to test with (default: finds latest Pending)
 */

import 'dotenv/config';
import crypto from 'node:crypto';

const WORKER_URL = process.env.WORKER_URL;
const RENDER_SERVICE_URL = process.env.RENDER_SERVICE_URL;
const SECRET = process.env.AI_WEBHOOK_SECRET;
const EXECUTE = process.argv.includes('--execute');

if (!SECRET) {
  console.error('ERROR: AI_WEBHOOK_SECRET is required');
  process.exit(1);
}

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(JSON.stringify(payload)).digest('hex');
}

async function main() {
  console.log(`\n=== AI Moderation Integration Test (${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}) ===\n`);

  // Step 1: Verify health endpoint
  if (RENDER_SERVICE_URL) {
    const healthUrl = RENDER_SERVICE_URL.replace('/moderate', '/health');
    try {
      const res = await fetch(healthUrl);
      const data = await res.json();
      console.log(`[✓] Render health check: ${data.status} (${data.timestamp})`);
    } catch (err) {
      console.error(`[✗] Render health check failed: ${err.message}`);
    }
  } else {
    console.log('[!] RENDER_SERVICE_URL not set — skipping Render health check');
  }

  // Step 2: Test HMAC verification with invalid signature
  if (RENDER_SERVICE_URL && EXECUTE) {
    console.log('\n--- Test: Invalid HMAC signature ---');
    const badPayload = { reportId: 99999, title: 'Test', description: 'Test', category: 'Others' };
    try {
      const res = await fetch(RENDER_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': 'invalid-hex-string-0000' },
        body: JSON.stringify(badPayload),
      });
      console.log(`[${res.status === 401 ? '✓' : '✗'}] Invalid signature rejected: HTTP ${res.status}`);
    } catch (err) {
      console.error(`[✗] Request failed: ${err.message}`);
    }
  }

  // Step 3: Test replay window with old timestamp
  if (RENDER_SERVICE_URL && EXECUTE) {
    console.log('\n--- Test: Replay window protection ---');
    const oldPayload = {
      reportId: 99999,
      title: 'Old Report',
      description: 'This timestamp is too old',
      category: 'Others',
      timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 minutes ago
    };
    try {
      const res = await fetch(RENDER_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sign(oldPayload) },
        body: JSON.stringify(oldPayload),
      });
      console.log(`[${res.status === 400 ? '✓' : '✗'}] Old timestamp rejected: HTTP ${res.status}`);
    } catch (err) {
      console.error(`[✗] Request failed: ${err.message}`);
    }
  }

  // Step 4: Test valid moderation request
  const reportId = process.env.TEST_REPORT_ID ? Number(process.env.TEST_REPORT_ID) : null;
  const validPayload = {
    reportId: reportId || 1,
    title: 'Integration test report',
    description: 'This is a test report for verifying the AI moderation pipeline end-to-end.',
    category: 'Others',
    imageKey: null,
    authorId: 'test-user',
    timestamp: new Date().toISOString(),
  };

  console.log('\n--- Test: Valid moderation request ---');
  console.log('Payload:', JSON.stringify(validPayload, null, 2));

  if (EXECUTE && RENDER_SERVICE_URL) {
    try {
      const res = await fetch(RENDER_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sign(validPayload) },
        body: JSON.stringify(validPayload),
      });
      const data = await res.json();
      console.log(`[${res.ok ? '✓' : '✗'}] Moderation request: HTTP ${res.status}`, data);
    } catch (err) {
      console.error(`[✗] Request failed: ${err.message}`);
    }
  } else {
    console.log('[i] Skipped (use --execute and set RENDER_SERVICE_URL to send)');
  }

  // Step 5: Test Worker webhook endpoint directly
  if (WORKER_URL && EXECUTE) {
    console.log('\n--- Test: Worker webhook endpoint ---');
    const workerPayload = {
      reportId: validPayload.reportId,
      verdict: 'approve',
      confidence: 0.95,
      reason: 'Integration test auto-approval',
      needsManualReview: false,
      timestamp: new Date().toISOString(),
    };
    try {
      const res = await fetch(`${WORKER_URL}/api/webhooks/ai-moderation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sign(workerPayload) },
        body: JSON.stringify(workerPayload),
      });
      const data = await res.json();
      console.log(`[${res.ok ? '✓' : '✗'}] Worker webhook: HTTP ${res.status}`, data);
    } catch (err) {
      console.error(`[✗] Request failed: ${err.message}`);
    }
  } else if (WORKER_URL) {
    console.log('\n[i] Worker webhook test skipped (use --execute to send)');
  } else {
    console.log('\n[i] WORKER_URL not set — skipping Worker webhook test');
  }

  console.log('\n=== Test complete ===\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
