import { createNotification } from './notification-service.js';
import { insertSystemComment } from './comment-service.js';
import { buildDisplayName } from './user-service.js';
import * as crypto from 'crypto';

/**
 * Handle AI moderation webhook from Render service
 * Expected payload:
 * {
 *   "reportId": 123,
 *   "verdict": "approve",
 *   "confidence": 0.85,
 *   "reason": "Clear road hazard description",
 *   "needsManualReview": false,
 *   "timestamp": "2026-10-18T09:00:05Z",
 *   "signature": "hmac-sha256-hash"
 * }
 */
export async function handleAiModerationWebhook(request, env) {
  try {
    const body = await request.json();
    const signature = request.headers.get('x-webhook-signature');
    
    // Validate signature (simplified - in production use HMAC with shared secret)
    if (!signature) {
      console.warn('[webhook] Missing signature');
      // For development, allow without signature
    }
    
    const { reportId, verdict, confidence, reason, needsManualReview } = body;
    
    if (!reportId || !verdict || confidence === undefined) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 });
    }
    
    console.log('[webhook] Received AI moderation result:', { reportId, verdict, confidence, needsManualReview });
    
    // Update report with AI moderation results
    const now = new Date().toISOString();
    await env.road_map_db.prepare(
      'UPDATE reports SET ai_verdict = ?, ai_confidence = ?, ai_reason = ?, ai_reviewed_at = ? WHERE id = ?',
    ).bind(verdict, confidence, reason, now, reportId).run();
    
    // Apply verdict
    if (verdict === 'approve' && !needsManualReview) {
      await env.road_map_db.prepare("UPDATE reports SET status = 'Open', updated_at = ? WHERE id = ? AND status = 'Pending'").bind(now, reportId).run();
      await createNotification(env, { userId: 'system', type: 'report_auto_approved', reportId, actorId: 'ai-system', message: 'Your report was auto-approved by AI and is now visible to the community.' });
      await insertSystemComment(env, reportId, `AI auto-approved this report (confidence: ${Math.round(confidence * 100)}%).`);
    } else if (verdict === 'reject' && !needsManualReview) {
      await env.road_map_db.prepare("UPDATE reports SET status = 'Rejected', updated_at = ?, archived_at = ? WHERE id = ? AND status = 'Pending'").bind(now, now, reportId).run();
      await createNotification(env, { userId: 'system', type: 'report_auto_rejected', reportId, actorId: 'ai-system', message: `Your report was auto-rejected by AI. Reason: ${reason}` });
      await insertSystemComment(env, reportId, `AI auto-rejected this report (confidence: ${Math.round(confidence * 100)}%). Reason: ${reason}`);
    } else {
      // Needs manual review - stays Pending
      await createNotification(env, { userId: 'system', type: 'report_needs_review', reportId, actorId: 'ai-system', message: `Your report requires manual review. AI confidence: ${Math.round(confidence * 100)}%.` });
    }
    
    return new Response(JSON.stringify({ success: true, message: 'Processed' }), { status: 200 });
    
  } catch (error) {
    console.error('[webhook] Error handling AI moderation webhook:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

// Export for routing
export { handleAiModerationWebhook };