import {
  getStatus,
  createBuzzOrderHandler,
  createCodeOrderHandler,
} from '~/server/controllers/coinbase.controller';
import { createBuzzChargeSchema, createCodeOrderSchema } from '~/server/schema/coinbase.schema';
import { isFlagProtected, protectedProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const coinbaseRouter = router({
  getStatus: protectedProcedure.meta({ requiredScope: TokenScope.Full }).query(getStatus),
  createBuzzOrder: protectedProcedure
    .meta({ requiredScope: TokenScope.Full })
    .input(createBuzzChargeSchema)
    .use(isFlagProtected('coinbasePayments'))
    .mutation(createBuzzOrderHandler),
  createCodeOrder: protectedProcedure
    .meta({ requiredScope: TokenScope.Full })
    .input(createCodeOrderSchema)
    .use(isFlagProtected('coinbasePayments'))
    .mutation(createCodeOrderHandler),
});
