/**
 * Retool-callable mod endpoints for ResourceReview writes.
 * =============================================================================
 *
 * Auth: Bearer <user API key> (mod role required).
 *
 * POST /api/mod/retool/review
 * Body: { "action": "<action>", ...params }
 *
 * Actions:
 *   setExclude - { reviewIds: number[], exclude: boolean }   Bulk set exclude flag.
 *   delete     - { reviewIds: number[] }                     Bulk delete.
 */
import * as z from 'zod';
import {
  deleteResourceReviews,
  setExcludeResourceReviews,
} from '~/server/services/resourceReview.service';
import { defineRetoolEndpoint, retoolAction } from '~/server/utils/retool-endpoint';

const reviewIds = z.array(z.coerce.number().int().positive()).min(1).max(500);

export default defineRetoolEndpoint('review', {
  setExclude: retoolAction({
    input: z.object({
      reviewIds,
      exclude: z.coerce.boolean(),
    }),
    rateLimit: { max: 30, windowSeconds: 60 },
    async handler(input) {
      const { count } = await setExcludeResourceReviews({
        ids: input.reviewIds,
        exclude: input.exclude,
      });
      return { count, affected: { reviewIds: input.reviewIds } };
    },
  }),
  delete: retoolAction({
    input: z.object({ reviewIds }),
    rateLimit: { max: 30, windowSeconds: 60 },
    async handler(input) {
      const { count } = await deleteResourceReviews({ ids: input.reviewIds });
      return { count, affected: { reviewIds: input.reviewIds } };
    },
  }),
});
