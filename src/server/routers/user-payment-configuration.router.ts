import { isFlagProtected, protectedProcedure, router } from '~/server/trpc';
import { getHandler } from '../controllers/user-payment-configuration.controller';
import {
  getStripeConnectOnboardingLink,
  getTipaltiDashboardUrl,
} from '../services/user-payment-configuration.service';
import { getTipaltiDashbordUrlSchema } from '~/server/schema/user-payment-configuration.schema';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const userPaymentConfigurationRouter = router({
  get: protectedProcedure.meta({ requiredScope: TokenScope.Full }).query(getHandler),
  getOnboardinLink: protectedProcedure
    .meta({ requiredScope: TokenScope.Full })
    .query(({ ctx }) => getStripeConnectOnboardingLink({ userId: ctx.user.id })),

  getTipaltiDashboardUrl: protectedProcedure
    .meta({ requiredScope: TokenScope.Full })
    .input(getTipaltiDashbordUrlSchema)
    .query(({ ctx, input }) =>
      getTipaltiDashboardUrl({ userId: ctx.user.id, type: input.type ?? 'setup' })
    ),
});
