import { getUserAccountHandler } from '~/server/controllers/signals.controller';
import { protectedProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const signalsRouter = router({
  getToken: protectedProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .query(getUserAccountHandler),
});
