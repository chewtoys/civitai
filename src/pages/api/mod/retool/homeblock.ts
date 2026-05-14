/**
 * Retool-callable mod endpoints for HomeBlock writes.
 * =============================================================================
 *
 * Auth: Bearer <user API key> (mod role required).
 *
 * POST /api/mod/retool/homeblock
 * Body: { "action": "<action>", ...params }
 *
 * Actions:
 *   create  - { type, metadata?, sourceId?, index?, permanent? }
 *             userId is taken from the calling moderator's session.
 *   update  - { homeBlockId, metadata?, index?, permanent?, type?, sourceId? }
 *   delete  - { homeBlockId }
 *   reorder - { orderedIds: number[] }   Sets `index` to position in array.
 *
 * Phase 4 ships an on-site HomeBlock Manager UI that consumes these same actions.
 */
import * as z from 'zod';
import {
  createHomeBlockAdmin,
  deleteHomeBlockAdmin,
  reorderHomeBlocksAdmin,
  updateHomeBlockAdmin,
} from '~/server/services/home-block.service';
import { defineRetoolEndpoint, retoolAction, retoolBoolean } from '~/server/utils/retool-endpoint';
import { HomeBlockType } from '~/shared/utils/prisma/enums';

const homeBlockId = z.coerce.number().int().positive();
const jsonObject = z.record(z.string(), z.unknown());

export default defineRetoolEndpoint('homeblock', {
  create: retoolAction({
    input: z.object({
      type: z.nativeEnum(HomeBlockType),
      metadata: jsonObject.optional(),
      sourceId: z.coerce.number().int().positive().optional(),
      index: z.coerce.number().int().optional(),
      permanent: retoolBoolean.optional(),
    }),
    rateLimit: { max: 30, windowSeconds: 60 },
    async handler(input) {
      const homeBlock = await createHomeBlockAdmin({
        type: input.type,
        metadata: (input.metadata ?? {}) as never,
        sourceId: input.sourceId,
        index: input.index,
        permanent: input.permanent,
      });
      return { id: homeBlock.id, affected: { homeBlockIds: [homeBlock.id] } };
    },
  }),
  update: retoolAction({
    input: z.object({
      homeBlockId,
      metadata: jsonObject.optional(),
      index: z.coerce.number().int().nullable().optional(),
      permanent: retoolBoolean.optional(),
      type: z.nativeEnum(HomeBlockType).optional(),
      sourceId: z.coerce.number().int().positive().nullable().optional(),
    }),
    rateLimit: { max: 60, windowSeconds: 60 },
    async handler(input) {
      const updated = await updateHomeBlockAdmin({
        id: input.homeBlockId,
        metadata: input.metadata as never,
        index: input.index,
        permanent: input.permanent,
        type: input.type,
        sourceId: input.sourceId,
      });
      return { id: updated.id, affected: { homeBlockIds: [updated.id] } };
    },
  }),
  delete: retoolAction({
    input: z.object({ homeBlockId }),
    rateLimit: { max: 30, windowSeconds: 60 },
    async handler(input) {
      await deleteHomeBlockAdmin({ id: input.homeBlockId });
      return { deleted: true, affected: { homeBlockIds: [input.homeBlockId] } };
    },
  }),
  reorder: retoolAction({
    input: z.object({
      orderedIds: z.array(z.coerce.number().int().positive()).min(1).max(200),
    }),
    rateLimit: { max: 30, windowSeconds: 60 },
    async handler(input) {
      const { count } = await reorderHomeBlocksAdmin({ orderedIds: input.orderedIds });
      return { count, affected: { homeBlockIds: input.orderedIds } };
    },
  }),
});
