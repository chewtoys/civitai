import {
  getRecommendedResourcesCardDataHandler,
  toggleResourceRecommendationHandler,
} from '~/server/controllers/recommenders.controller';
import { getByIdSchema } from '~/server/schema/base.schema';
import { recommendationRequestSchema } from '~/server/schema/recommenders.schema';
import { isFlagProtected, protectedProcedure, publicProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const recommendersRouter = router({
  getResourceRecommendations: publicProcedure
    .meta({ requiredScope: TokenScope.AIServicesRead })
    .input(recommendationRequestSchema)
    .use(isFlagProtected('recommenders'))
    .query(getRecommendedResourcesCardDataHandler),
  toggleResourceRecommendations: protectedProcedure
    .meta({ requiredScope: TokenScope.AIServicesWrite })
    .input(getByIdSchema)
    .use(isFlagProtected('recommenders'))
    .mutation(toggleResourceRecommendationHandler),
});
