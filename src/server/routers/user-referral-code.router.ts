import { protectedProcedure, router } from '~/server/trpc';
import {
  deleteUserReferralCodeHandler,
  getUserReferralCodesHandler,
  upsertUserReferralCodeHandler,
} from '~/server/controllers/user-referral-code.controller';
import {
  getUserReferralCodesSchema,
  upsertUserReferralCodesSchema,
} from '~/server/schema/user-referral-code.schema';
import { getByIdSchema } from '~/server/schema/base.schema';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const userReferralCodeRouter = router({
  getAll: protectedProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .input(getUserReferralCodesSchema)
    .query(getUserReferralCodesHandler),
  upsert: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(upsertUserReferralCodesSchema)
    .mutation(upsertUserReferralCodeHandler),
  delete: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(getByIdSchema)
    .mutation(deleteUserReferralCodeHandler),
});
