import * as z from 'zod';

import {
  deleteAccountHandler,
  getUserAccountsHandler,
} from '~/server/controllers/account.controller';
import { getByIdSchema } from '~/server/schema/base.schema';
import { protectedProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const accountRouter = router({
  getAll: protectedProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .query(getUserAccountsHandler),
  delete: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(getByIdSchema)
    .mutation(deleteAccountHandler),
});
