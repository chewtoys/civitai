/**
 * Debug endpoint for exercising the full XGuard prompt-mode pipeline:
 * Redis policy fetch → labelOverrides → orchestrator submit → wait.
 *
 * GET /api/admin/test?token=$WEBHOOK_TOKEN
 *
 * Edit the constants below to change what gets scanned. Labels listed in
 * `LABELS` that don't have a Redis entry at /moderator/xguard-policies are
 * silently dropped. If LABELS is empty, every configured prompt-mode policy
 * runs. If nothing's configured for any requested label, the call short-
 * circuits and the endpoint returns `{ status: 'skipped' }`.
 */
import { createXGuardModerationRequest } from '~/server/services/orchestrator/orchestrator.service';
import { WebhookEndpoint } from '~/server/utils/endpoint-helpers';

const POSITIVE_PROMPT = 'a photo of a woman in a park';
const NEGATIVE_PROMPT = '';
const LABELS: string[] = ['cr', 'csam']; // empty array = use every configured policy

export default WebhookEndpoint(async (req, res) => {
  const workflow = await createXGuardModerationRequest({
    mode: 'prompt',
    entityType: 'admin-test',
    entityId: 0,
    positivePrompt: POSITIVE_PROMPT,
    negativePrompt: NEGATIVE_PROMPT || undefined,
    labels: LABELS.length > 0 ? LABELS : undefined,
    wait: 60,
  });

  if (!workflow) {
    res.status(200).json({
      status: 'skipped',
      reason: 'no-redis-policies-matched',
      requestedLabels: LABELS,
    });
    return;
  }

  res.status(200).json({ workflow });
});
