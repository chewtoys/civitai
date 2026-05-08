import { getTRPCErrorFromUnknown } from '@trpc/server';
import type { ProtectedContext } from '~/server/createContext';
import { getAccessToken } from '~/server/services/signals.service';

export function getUserAccountHandler({ ctx }: { ctx: ProtectedContext }) {
  try {
    return getAccessToken({ id: ctx.user.id });
  } catch (error) {
    throw getTRPCErrorFromUnknown(error);
  }
}
