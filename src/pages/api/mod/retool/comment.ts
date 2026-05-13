/**
 * Retool-callable mod endpoints for Comment + CommentV2 writes.
 * =============================================================================
 *
 * Auth: Bearer <user API key> (mod role required).
 *
 * POST /api/mod/retool/comment
 * Body: { "action": "<action>", ...params }
 *
 * Actions:
 *   bulkDelete  - { commentIds?: number[], commentV2Ids?: number[] }
 *                 At least one list required. Deletes the rows; metrics queued.
 *   removeAsTos - { commentIds?: number[], commentV2Ids?: number[] }
 *                 Flags tosViolation=true, actions related TOSViolation reports
 *                 (with reporter rewards), notifies the comment owner.
 */
import requestIp from 'request-ip';
import * as z from 'zod';
import {
  bulkDeleteComments,
  bulkSetCommentTosViolation,
} from '~/server/services/comment.service';
import {
  bulkDeleteCommentsV2,
  bulkSetCommentV2TosViolation,
} from '~/server/services/commentsv2.service';
import { defineRetoolEndpoint, retoolAction } from '~/server/utils/retool-endpoint';

const idList = z.array(z.coerce.number().int().positive()).max(500);

const commentIdSchema = z
  .object({
    commentIds: idList.optional(),
    commentV2Ids: idList.optional(),
  })
  .refine(
    (data) => (data.commentIds?.length ?? 0) + (data.commentV2Ids?.length ?? 0) > 0,
    { message: 'At least one of commentIds or commentV2Ids must be non-empty' }
  );

export default defineRetoolEndpoint('comment', {
  bulkDelete: retoolAction({
    input: commentIdSchema,
    rateLimit: { max: 30, windowSeconds: 60 },
    async handler(input) {
      const v1 = input.commentIds?.length
        ? await bulkDeleteComments({ ids: input.commentIds })
        : { count: 0 };
      const v2 = input.commentV2Ids?.length
        ? await bulkDeleteCommentsV2({ ids: input.commentV2Ids })
        : { count: 0 };
      return {
        commentDeleted: v1.count,
        commentV2Deleted: v2.count,
        affected: {
          commentIds: input.commentIds ?? [],
          commentV2Ids: input.commentV2Ids ?? [],
        },
      };
    },
  }),
  removeAsTos: retoolAction({
    input: commentIdSchema,
    rateLimit: { max: 30, windowSeconds: 60 },
    async handler(input, ctx) {
      const ip = requestIp.getClientIp(ctx.req) ?? undefined;
      const fingerprint = (ctx.req.headers['x-fingerprint'] as string | undefined) ?? undefined;
      const actor = { id: ctx.actor.id, ip, fingerprint };

      const v1 = input.commentIds?.length
        ? await bulkSetCommentTosViolation({ ids: input.commentIds, actor })
        : { count: 0, notified: 0, rewardedReports: 0 };
      const v2 = input.commentV2Ids?.length
        ? await bulkSetCommentV2TosViolation({ ids: input.commentV2Ids, actor })
        : { count: 0, notified: 0, rewardedReports: 0 };

      return {
        comment: v1,
        commentV2: v2,
        affected: {
          commentIds: input.commentIds ?? [],
          commentV2Ids: input.commentV2Ids ?? [],
        },
      };
    },
  }),
});
