import { updateSubscriptionSchema } from '~/server/schema/newsletter.schema';
import {
  getSubscription,
  postponeSubscription,
  updateSubscription,
} from '~/server/services/newsletter.service';
import { protectedProcedure, publicProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const newsletterRouter = router({
  getSubscription: publicProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .query(({ ctx }) => getSubscription(ctx.user?.email)),
  updateSubscription: publicProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(updateSubscriptionSchema)
    .mutation(({ input, ctx }) =>
      updateSubscription({
        ...input,
        email: input.email ?? ctx.user?.email,
        userId: ctx.user?.id,
      })
    ),
  postpone: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .mutation(({ ctx }) => postponeSubscription(ctx.user.id)),
});
