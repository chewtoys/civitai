import type { NextApiRequest, NextApiResponse } from 'next';
import type { SessionUser } from 'next-auth';

import { AuthedEndpoint } from '~/server/utils/endpoint-helpers';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export default AuthedEndpoint(async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  user: SessionUser
) {
  const context = (req as any).context ?? {};
  const tokenScope: number | undefined = context.tokenScope;
  const buzzLimit = context.buzzLimit ?? null;
  const subject = context.subject ?? null;

  res.send({
    id: user.id,
    username: user.username,
    tier: user.tier,
    status: user.bannedAt ? 'banned' : user.muted ? 'muted' : 'active',
    isMember: user.tier ? user.tier !== 'free' : false,
    subscriptions: Object.keys(user.subscriptions ?? {}),
    // Token-specific fields (only present when auth is via API key/OAuth token).
    // `subject` carries the (type, id) pair the orchestrator buckets spend by.
    // For OAuth-issued tokens the id is the clientId (stable across refresh
    // rotations); for User-type keys it's the ApiKey row id.
    ...(tokenScope !== undefined && tokenScope !== TokenScope.Full
      ? { tokenScope, buzzLimit, subject }
      : {}),
  });
});
