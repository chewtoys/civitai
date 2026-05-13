/**
 * Retool-callable mod endpoints for Cosmetic + UserCosmetic writes.
 * =============================================================================
 *
 * Auth: Bearer <user API key> (mod role required).
 *
 * POST /api/mod/retool/cosmetic
 * Body: { "action": "<action>", ...params }
 *
 * Actions:
 *   assignByTarget  - { cosmeticId, target, dryRun? }
 *                     target = { type: 'collection', collectionId, requireApproved? }
 *                            | { type: 'userIds', userIds: number[] }
 *   unassign        - { cosmeticId, userIds: number[] }
 *   createCosmetic  - full Cosmetic shape (name, type, source, data, etc.)
 *   updateCosmetic  - { cosmeticId, ...partial }
 *   deleteCosmetic  - { cosmeticId }
 */
import * as z from 'zod';
import {
  assignCosmeticByTarget,
  createCosmetic,
  deleteCosmetic,
  unassignCosmetic,
  updateCosmetic,
} from '~/server/services/cosmetic.service';
import { defineRetoolEndpoint, retoolAction } from '~/server/utils/retool-endpoint';
import { CosmeticSource, CosmeticType } from '~/shared/utils/prisma/enums';

const cosmeticId = z.coerce.number().int().positive();
const userIds = z.array(z.coerce.number().int().positive()).min(1).max(5000);

const cosmeticShape = z.object({
  name: z.string().min(1).max(255),
  description: z.string().nullish(),
  videoUrl: z.string().url().nullish(),
  type: z.nativeEnum(CosmeticType),
  source: z.nativeEnum(CosmeticSource),
  permanentUnlock: z.coerce.boolean(),
  data: z.record(z.string(), z.unknown()),
  availableStart: z.coerce.date().nullish(),
  availableEnd: z.coerce.date().nullish(),
  availableQuery: z.string().nullish(),
  productId: z.string().nullish(),
  leaderboardId: z.string().nullish(),
  leaderboardPosition: z.coerce.number().int().nullish(),
});

export default defineRetoolEndpoint('cosmetic', {
  assignByTarget: retoolAction({
    input: z.object({
      cosmeticId,
      target: z.discriminatedUnion('type', [
        z.object({
          type: z.literal('collection'),
          collectionId: z.coerce.number().int().positive(),
          requireApproved: z.coerce.boolean().optional(),
        }),
        z.object({
          type: z.literal('userIds'),
          userIds,
        }),
      ]),
      dryRun: z.coerce.boolean().optional(),
    }),
    rateLimit: { max: 10, windowSeconds: 60 },
    async handler(input) {
      const result = await assignCosmeticByTarget({
        cosmeticId: input.cosmeticId,
        target: input.target,
        dryRun: input.dryRun,
      });
      return {
        granted: result.granted,
        userCount: result.userIds.length,
        dryRun: result.dryRun,
        affected: { cosmeticIds: [input.cosmeticId], userIds: result.userIds },
      };
    },
  }),
  unassign: retoolAction({
    input: z.object({ cosmeticId, userIds }),
    rateLimit: { max: 30, windowSeconds: 60 },
    async handler(input) {
      const { count } = await unassignCosmetic({
        cosmeticId: input.cosmeticId,
        userIds: input.userIds,
      });
      return {
        count,
        affected: { cosmeticIds: [input.cosmeticId], userIds: input.userIds },
      };
    },
  }),
  createCosmetic: retoolAction({
    input: cosmeticShape,
    rateLimit: { max: 20, windowSeconds: 60 },
    async handler(input) {
      const cosmetic = await createCosmetic(input as never);
      return { id: cosmetic.id, affected: { cosmeticIds: [cosmetic.id] } };
    },
  }),
  updateCosmetic: retoolAction({
    input: cosmeticShape.partial().extend({ cosmeticId }),
    rateLimit: { max: 30, windowSeconds: 60 },
    async handler(input) {
      const { cosmeticId: id, ...patch } = input;
      const cosmetic = await updateCosmetic({ id, data: patch as never });
      return { id: cosmetic.id, affected: { cosmeticIds: [cosmetic.id] } };
    },
  }),
  deleteCosmetic: retoolAction({
    input: z.object({ cosmeticId }),
    rateLimit: { max: 10, windowSeconds: 60 },
    async handler(input) {
      await deleteCosmetic({ id: input.cosmeticId });
      return { deleted: true, affected: { cosmeticIds: [input.cosmeticId] } };
    },
  }),
});
