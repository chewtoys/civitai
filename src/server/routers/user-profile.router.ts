import {
  guardedProcedure,
  isFlagProtected,
  protectedProcedure,
  publicProcedure,
  router,
} from '~/server/trpc';
import {
  addEntityToShowcaseHandler,
  getUserContentOverviewHandler,
  getUserProfileHandler,
  updateUserProfileHandler,
} from '~/server/controllers/user-profile.controller';
import {
  getUserProfileSchema,
  showcaseItemSchema,
  userProfileUpdateSchema,
} from '~/server/schema/user-profile.schema';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const userProfileRouter = router({
  get: publicProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .input(getUserProfileSchema)
    .query(getUserProfileHandler),
  overview: publicProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .input(getUserProfileSchema)
    .query(getUserContentOverviewHandler),
  update: guardedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(userProfileUpdateSchema)
    .mutation(updateUserProfileHandler),
  addEntityToShowcase: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(showcaseItemSchema)
    .mutation(addEntityToShowcaseHandler),
});
