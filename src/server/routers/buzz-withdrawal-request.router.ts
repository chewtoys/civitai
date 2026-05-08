import { REDIS_SYS_KEYS, sysRedis } from '~/server/redis/client';
import { getByIdStringSchema } from '~/server/schema/base.schema';
import {
  cancelBuzzWithdrawalRequestHandler,
  createBuzzWithdrawalRequestHandler,
  getPaginatedBuzzWithdrawalRequestsHandler,
  getPaginatedOwnedBuzzWithdrawalRequestsHandler,
  updateBuzzWithdrawalRequestHandler,
} from '../controllers/buzz-withdrawal-request.controller';
import type { BuzzWithdrawalRequestServiceStatus } from '../schema/buzz-withdrawal-request.schema';
import {
  buzzWithdrawalRequestServiceStatusSchema,
  createBuzzWithdrawalRequestSchema,
  getPaginatedBuzzWithdrawalRequestSchema,
  getPaginatedOwnedBuzzWithdrawalRequestSchema,
  updateBuzzWithdrawalRequestSchema,
} from '../schema/buzz-withdrawal-request.schema';
import { isFlagProtected, moderatorProcedure, protectedProcedure, router } from '../trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const buzzWithdrawalRequestRouter = router({
  getPaginatedOwned: protectedProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .input(getPaginatedOwnedBuzzWithdrawalRequestSchema)
    .use(isFlagProtected('creatorsProgram'))
    .query(getPaginatedOwnedBuzzWithdrawalRequestsHandler),
  getPaginated: moderatorProcedure
    .input(getPaginatedBuzzWithdrawalRequestSchema)
    .use(isFlagProtected('creatorsProgram'))
    .query(getPaginatedBuzzWithdrawalRequestsHandler),
  create: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(createBuzzWithdrawalRequestSchema)
    .use(isFlagProtected('creatorsProgram'))
    .mutation(createBuzzWithdrawalRequestHandler),
  cancel: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(getByIdStringSchema)
    .use(isFlagProtected('creatorsProgram'))
    .mutation(cancelBuzzWithdrawalRequestHandler),
  update: moderatorProcedure
    .input(updateBuzzWithdrawalRequestSchema)
    .use(isFlagProtected('creatorsProgram'))
    .mutation(updateBuzzWithdrawalRequestHandler),
  getServiceStatus: protectedProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .query(async () => {
      const status = buzzWithdrawalRequestServiceStatusSchema.parse(
        JSON.parse(
          (await sysRedis.hGet(
            REDIS_SYS_KEYS.SYSTEM.FEATURES,
            REDIS_SYS_KEYS.BUZZ_WITHDRAWAL_REQUEST.STATUS
          )) ?? '{}'
        )
      );

      return status as BuzzWithdrawalRequestServiceStatus;
    }),
  // update:
});
