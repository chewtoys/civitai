/**
 * Local-dev / debug endpoint for one-shot XGuard audits.
 * =============================================================================
 *
 * Submits a `WildcardSetCategory`'s values to the orchestrator as a single
 * xGuardModeration step (text mode, same labels as the production audit
 * pipeline) and returns the workflow ID so the caller can poll the
 * orchestrator manually. No callback is registered — this is meant for
 * inspecting raw XGuard output without polluting the production audit state
 * machine. The category's `auditStatus` and `metadata.workflowId` are *not*
 * touched.
 *
 * Guarded by `WEBHOOK_TOKEN` via `?token=` (see `WebhookEndpoint`).
 *
 * Usage:
 *   GET or POST /api/admin/test2?token=$WEBHOOK_TOKEN&categoryId=<id>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { XGuardModerationStepTemplate } from '@civitai/client';
import { submitWorkflow } from '@civitai/client';
import * as z from 'zod';
import { dbRead } from '~/server/db/client';
import { internalOrchestratorClient } from '~/server/services/orchestrator/client';
import { WebhookEndpoint } from '~/server/utils/endpoint-helpers';

// Mirrors the production constant so manual probes evaluate against the same
// label set the audit pipeline uses. Keep in sync with
// wildcard-category-audit.service.ts → WILDCARD_AUDIT_LABELS.
const WILDCARD_AUDIT_LABELS = [
  'csam',
  'urine',
  'diaper',
  'scat',
  'menstruation',
  'bestiality',
] as const;

const schema = z.object({
  categoryId: z.coerce.number().int().positive(),
});

export default WebhookEndpoint(async function (req: NextApiRequest, res: NextApiResponse) {
  const payload = schema.safeParse({ ...req.query, ...(req.body ?? {}) });
  if (!payload.success) {
    return res.status(400).json({ error: 'Invalid request', issues: payload.error.issues });
  }
  const { categoryId } = payload.data;

  const category = await dbRead.wildcardSetCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, values: true, wildcardSetId: true },
  });
  if (!category) return res.status(404).json({ error: `category ${categoryId} not found` });
  if (!category.values || category.values.length === 0) {
    return res.status(400).json({ error: 'category has no values to audit' });
  }

  const text = category.values.join('\n');
  const metadata = { wildcardSetCategoryId: category.id, source: 'test2' };

  try {
    const { data, error, response } = await submitWorkflow({
      client: internalOrchestratorClient,
      body: {
        metadata,
        currencies: [],
        steps: [
          {
            $type: 'xGuardModeration',
            name: 'textModeration',
            metadata,
            priority: 'low',
            input: {
              text,
              mode: 'text',
              labels: [...WILDCARD_AUDIT_LABELS],
              storeFullResponse: false,
            },
          } as XGuardModerationStepTemplate,
        ],
      },
    });

    if (!data?.id) {
      return res.status(502).json({
        error: 'orchestrator returned no workflow id',
        responseStatus: response?.status,
        orchestratorError: error,
      });
    }

    return res.status(200).json({
      workflowId: data.id,
      categoryId: category.id,
      categoryName: category.name,
      wildcardSetId: category.wildcardSetId,
      valueCount: category.values.length,
      labels: WILDCARD_AUDIT_LABELS,
    });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
  }
});
