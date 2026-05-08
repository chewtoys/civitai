import { airConfirmSchema } from '~/server/schema/integration.schema';
import { confirmAir, getAirStatus } from '~/server/services/integration.service';
import { protectedProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const integrationRouter = router({
  airStatus: protectedProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .query(({ ctx }) => getAirStatus(ctx.user.id)),
  airConfirm: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(airConfirmSchema)
    .mutation(({ input, ctx }) => confirmAir({ email: input.email, userId: ctx.user.id })),
});
