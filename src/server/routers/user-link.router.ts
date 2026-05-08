import { getByIdSchema } from './../schema/base.schema';
import {
  deleteUserLinkHandler,
  getUserLinksHandler,
  upsertManyUserLinksHandler,
  upsertUserLinkHandler,
} from './../controllers/user-link.controller';
import {
  getUserLinksSchema,
  upsertManyUserLinkSchema,
  upsertUserLinkSchema,
} from './../schema/user-link.schema';
import { protectedProcedure, publicProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const userLinkRouter = router({
  getAll: publicProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .input(getUserLinksSchema)
    .query(getUserLinksHandler),
  upsertMany: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(upsertManyUserLinkSchema)
    .mutation(upsertManyUserLinksHandler),
  upsert: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(upsertUserLinkSchema)
    .mutation(upsertUserLinkHandler),
  delete: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(getByIdSchema)
    .mutation(deleteUserLinkHandler),
});
