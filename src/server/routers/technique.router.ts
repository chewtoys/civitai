import { CacheTTL } from '~/server/common/constants';
import { edgeCacheIt } from '~/server/middleware.trpc';
import { getAllTechniques } from '~/server/services/technique.service';
import { publicProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const techniqueRouter = router({
  getAll: publicProcedure
    .meta({ requiredScope: TokenScope.AIServicesRead })
    .use(edgeCacheIt({ ttl: CacheTTL.hour }))
    .query(() => getAllTechniques()),
});
