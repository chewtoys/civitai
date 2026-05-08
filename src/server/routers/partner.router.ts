import { router, publicProcedure } from '~/server/trpc';
import { getAllPartners } from '~/server/services/partner.service';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const partnerRouter = router({
  getAll: publicProcedure
    .meta({ requiredScope: TokenScope.ModelsRead })
    .query(() => getAllPartners()),
});
