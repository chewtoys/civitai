import {
  createBuzzOrderHandler,
  processBuzzOrderHandler,
} from './../controllers/paypal.controller';
import { router, protectedProcedure } from '~/server/trpc';
import { paypalOrderSchema, paypalPurchaseBuzzSchema } from '../schema/paypal.schema';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const paypalRouter = router({
  createBuzzOrder: protectedProcedure
    .meta({ requiredScope: TokenScope.Full })
    .input(paypalPurchaseBuzzSchema)
    .mutation(createBuzzOrderHandler),
  processBuzzOrder: protectedProcedure
    .meta({ requiredScope: TokenScope.Full })
    .input(paypalOrderSchema)
    .mutation(processBuzzOrderHandler),
});
