/**
 * Debug endpoint for inspecting an XGuard prompt-mode scan end-to-end.
 *
 * GET /api/admin/test?token=$WEBHOOK_TOKEN
 *
 * Submits an xGuardModeration step in prompt mode with labels ['nsfw', 'csam'],
 * waits for completion, and returns the full workflow JSON so we can inspect
 * the response shape (specifically: whether a per-label policy hash comes back
 * for use as our policyVersion).
 *
 * Uses storeFullResponse=true so the response includes everything the model
 * emits, including non-triggered label scores and any reasoning text.
 *
 * Edit `TEST_PROMPT` below to change what gets scanned.
 */
import type { XGuardModerationStepTemplate } from '@civitai/client';
import { submitWorkflow } from '@civitai/client';
import { internalOrchestratorClient } from '~/server/services/orchestrator/client';
import { WebhookEndpoint } from '~/server/utils/endpoint-helpers';

const POSITIVE_PROMPT = 'a photo of a woman in a park';
const NEGATIVE_PROMPT = '';

export default WebhookEndpoint(async (req, res) => {
  const { data, error, response } = await submitWorkflow({
    client: internalOrchestratorClient,
    query: { wait: 60 },
    body: {
      metadata: { source: 'admin-test' },
      currencies: [],
      steps: [
        {
          $type: 'xGuardModeration',
          name: 'promptModeration',
          priority: 'normal',
          input: {
            mode: 'prompt',
            positivePrompt: POSITIVE_PROMPT,
            negativePrompt: NEGATIVE_PROMPT || null,
            labels: ['cr', 'csam'],
            storeFullResponse: false,
          },
        } as XGuardModerationStepTemplate,
      ],
    },
  });

  res.status(data ? 200 : 500).json({
    status: response?.status,
    error,
    workflow: data,
  });
});
