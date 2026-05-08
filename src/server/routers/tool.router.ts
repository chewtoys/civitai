import { CacheTTL } from '~/server/common/constants';
import { edgeCacheIt } from '~/server/middleware.trpc';
import { getAllToolsSchema } from '~/server/schema/tool.schema';
import { getAllTools } from '~/server/services/tool.service';
import { publicProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const toolRouter = router({
  getAll: publicProcedure
    .meta({ requiredScope: TokenScope.AIServicesRead })
    .input(getAllToolsSchema.optional())
    .use(edgeCacheIt({ ttl: CacheTTL.hour }))
    .query(({ input }) => getAllTools(input)),
});
