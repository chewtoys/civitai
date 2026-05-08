import { publicProcedure, router } from '~/server/trpc';
import { getBuildGuides } from '~/server/services/build-guide.services';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const buildGuideRouter = router({
  getAll: publicProcedure
    .meta({ requiredScope: TokenScope.ArticlesRead })
    .query(() => getBuildGuides()),
});
