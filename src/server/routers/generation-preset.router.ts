import {
  createHandler,
  deleteHandler,
  getAvailableHandler,
  getByIdHandler,
  getForEcosystemHandler,
  getOwnHandler,
  reorderHandler,
  updateHandler,
} from '~/server/controllers/generation-preset.controller';
import { getByIdSchema } from '~/server/schema/base.schema';
import {
  createGenerationPresetInputSchema,
  getPresetsForEcosystemInputSchema,
  reorderGenerationPresetsInputSchema,
  updateGenerationPresetInputSchema,
} from '~/server/schema/generation-preset.schema';
import { protectedProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const generationPresetRouter = router({
  getForEcosystem: protectedProcedure
    .meta({ requiredScope: TokenScope.AIServicesRead })
    .input(getPresetsForEcosystemInputSchema)
    .query(getForEcosystemHandler),
  getOwn: protectedProcedure
    .meta({ requiredScope: TokenScope.AIServicesRead })
    .query(getOwnHandler),
  getAvailable: protectedProcedure
    .meta({ requiredScope: TokenScope.AIServicesRead })
    .query(getAvailableHandler),
  getById: protectedProcedure
    .meta({ requiredScope: TokenScope.AIServicesRead })
    .input(getByIdSchema)
    .query(getByIdHandler),
  create: protectedProcedure
    .meta({ requiredScope: TokenScope.AIServicesWrite })
    .input(createGenerationPresetInputSchema)
    .mutation(createHandler),
  update: protectedProcedure
    .meta({ requiredScope: TokenScope.AIServicesWrite })
    .input(updateGenerationPresetInputSchema)
    .mutation(updateHandler),
  delete: protectedProcedure
    .meta({ requiredScope: TokenScope.AIServicesWrite })
    .input(getByIdSchema)
    .mutation(deleteHandler),
  reorder: protectedProcedure
    .meta({ requiredScope: TokenScope.AIServicesWrite })
    .input(reorderGenerationPresetsInputSchema)
    .mutation(reorderHandler),
});
