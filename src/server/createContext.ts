import { NextApiRequest, NextApiResponse } from 'next';
import { env } from '~/env/server.mjs';
import { getServerAuthSession } from '~/server/utils/get-server-auth-session';
import { Tracker } from './clickhouse/client';
import requestIp from 'request-ip';
import { isProd } from '~/env/other';
import { getFeatureFlagsLazy } from '~/server/services/feature-flags.service';
import { createCallerFactory } from '@trpc/server';
import { appRouter } from '~/server/routers';

type CacheSettings = {
  browserTTL?: number;
  edgeTTL?: number;
  staleWhileRevalidate?: number;
  tags?: string[];
  canCache?: boolean;
  skip: boolean;
};

const origins = [...env.TRPC_ORIGINS];
const hosts = [
  env.NEXT_PUBLIC_SERVER_DOMAIN_GREEN,
  env.NEXT_PUBLIC_SERVER_DOMAIN_BLUE,
  env.NEXT_PUBLIC_SERVER_DOMAIN_RED,
];
export const createContext = async ({
  req,
  res,
}: {
  req: NextApiRequest;
  res: NextApiResponse;
}) => {
  const session = await getServerAuthSession({ req, res });
  const ip = requestIp.getClientIp(req) ?? '';
  const acceptableOrigin = isProd
    ? (origins.some((o) => req.headers.referer?.startsWith(o)) ||
        hosts.some((h) => req.headers.host === h)) ??
      false
    : true;
  const track = new Tracker(req, res);
  const cache: CacheSettings | null = {
    browserTTL: session?.user ? 0 : 60,
    edgeTTL: session?.user ? 0 : 60,
    staleWhileRevalidate: session?.user ? 0 : 30,
    canCache: true,
    skip: false,
  };

  return {
    user: session?.user,
    acceptableOrigin,
    features: getFeatureFlagsLazy({ user: session?.user, req }),
    track,
    ip,
    cache,
    res,
    req,
  };
};

const createCaller = createCallerFactory()(appRouter);
export const publicApiContext2 = (req: NextApiRequest, res: NextApiResponse) =>
  createCaller({
    user: undefined,
    acceptableOrigin: true,
    features: getFeatureFlagsLazy({ req }),
    track: new Tracker(req, res),
    ip: requestIp.getClientIp(req) ?? '',
    cache: {
      browserTTL: 3 * 60,
      edgeTTL: 3 * 60,
      staleWhileRevalidate: 60,
      canCache: true,
      skip: false,
    },
    res,
    req,
  });

export const publicApiContext = (req: NextApiRequest, res: NextApiResponse) => ({
  user: undefined,
  acceptableOrigin: true,
  features: getFeatureFlagsLazy({ req }),
  track: new Tracker(req, res),
  ip: requestIp.getClientIp(req) ?? '',
  cache: {
    browserCacheTTL: 3 * 60,
    edgeCacheTTL: 3 * 60,
    staleWhileRevalidate: 60,
    canCache: true,
    skip: false,
  },
  res,
  req,
});

export type Context = AsyncReturnType<typeof createContext>;
