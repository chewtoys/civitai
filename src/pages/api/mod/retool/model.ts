/**
 * Retool-callable mod endpoints for Model writes.
 * =============================================================================
 *
 * Auth: Bearer <user API key> (mod role required).
 *
 * POST /api/mod/retool/model
 * Body: { "action": "<action>", ...params }
 *
 * Actions:
 *   bump - { modelId }   Push model to top of Newest feed (sets lastVersionAt = NOW()).
 *                        Invalidates feed + search + user-count caches.
 */
import * as z from 'zod';
import { bumpModel } from '~/server/services/model.service';
import { defineRetoolEndpoint, retoolAction } from '~/server/utils/retool-endpoint';

export default defineRetoolEndpoint('model', {
  bump: retoolAction({
    input: z.object({
      modelId: z.coerce.number().int().positive(),
    }),
    rateLimit: { max: 30, windowSeconds: 60 },
    async handler(input) {
      const updated = await bumpModel({ id: input.modelId });
      return {
        modelId: updated.id,
        lastVersionAt: updated.lastVersionAt,
        affected: { modelIds: [updated.id] },
      };
    },
  }),
});
