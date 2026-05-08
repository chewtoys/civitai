import type { ProtectedContext } from '~/server/createContext';
import { throwAuthorizationError } from '~/server/utils/errorHandling';
import { createBuzzOrder, createCodeOrder } from '~/server/services/coinbase.service';
import coinbaseCaller from '~/server/http/coinbase/coinbase.caller';
import type { CreateBuzzCharge, CreateCodeOrder } from '~/server/schema/coinbase.schema';

export const getStatus = async () => {
  return coinbaseCaller.isAPIHealthy();
};

export const createBuzzOrderHandler = async ({
  input,
  ctx,
}: {
  ctx: ProtectedContext;
  input: CreateBuzzCharge;
}) => {
  if (!ctx.user.email) {
    throw throwAuthorizationError('Email is required to create a transaction');
  }

  return createBuzzOrder({
    ...input,
    userId: ctx.user.id,
  });
};

export const createCodeOrderHandler = async ({
  input,
  ctx,
}: {
  ctx: ProtectedContext;
  input: CreateCodeOrder;
}) => {
  if (!ctx.user.email) {
    throw throwAuthorizationError('Email is required to create a transaction');
  }

  return createCodeOrder({
    ...input,
    userId: ctx.user.id,
  });
};
