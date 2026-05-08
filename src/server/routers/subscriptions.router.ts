import * as z from 'zod';
import {
  getPlansSchema,
  getUserSubscriptionSchema,
  claimPrepaidTokenSchema,
} from '~/server/schema/subscriptions.schema';
import {
  getPlansHandler,
  getUserSubscriptionHandler,
  getAllUserSubscriptionsHandler,
} from './../controllers/subscriptions.controller';
import { publicProcedure, protectedProcedure, moderatorProcedure, router } from '~/server/trpc';
import {
  claimPrepaidToken,
  claimAllPrepaidTokens,
  unlockTokensForUser,
  getHistoricalPrepaidDeliveries,
} from '~/server/services/subscriptions.service';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const subscriptionsRouter = router({
  getPlans: publicProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .input(getPlansSchema)
    .query(getPlansHandler),
  getUserSubscription: publicProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .input(getUserSubscriptionSchema.partial().optional())
    .query(getUserSubscriptionHandler),
  getAllUserSubscriptions: publicProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .query(getAllUserSubscriptionsHandler),
  claimPrepaidToken: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(claimPrepaidTokenSchema)
    .mutation(async ({ input, ctx }) => {
      return claimPrepaidToken({ tokenId: input.tokenId, userId: ctx.user.id });
    }),
  claimAllPrepaidTokens: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .mutation(async ({ ctx }) => {
      return claimAllPrepaidTokens({ userId: ctx.user.id });
    }),
  getHistoricalPrepaidDeliveries: protectedProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .input(z.object({ accountType: z.enum(['yellow', 'green']).default('yellow') }))
    .query(async ({ input, ctx }) => {
      return getHistoricalPrepaidDeliveries({
        userId: ctx.user.id,
        accountType: input.accountType,
      });
    }),
  unlockTokens: moderatorProcedure
    .input(z.object({ userId: z.number(), force: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      return unlockTokensForUser({ userId: input.userId, force: input.force });
    }),
});
