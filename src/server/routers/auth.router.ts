import { router, publicProcedure, protectedProcedure } from '~/server/trpc';
import { getProviders } from 'next-auth/react';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const authRouter = router({
  getUser: publicProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .query(({ ctx }) => ctx.user),
  getSecretMessage: protectedProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .query(() => 'You are logged in and can see this secret message!'),
  getProviders: publicProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .query(() =>
      getProviders().then((data) =>
        data ? Object.values(data).filter((x) => x.type === 'oauth') : []
      )
    ),
});
