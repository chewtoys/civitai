import type { NextApiRequest, NextApiResponse } from 'next';
import { Request, Response } from '@node-oauth/oauth2-server';
import requestIp from 'request-ip';
import { oauthServer } from '~/server/oauth/server';
import { addCorsHeaders } from '~/server/utils/endpoint-helpers';
import { checkOAuthRateLimit, sendRateLimitResponse } from '~/server/oauth/rate-limit';
import { logOAuthEvent } from '~/server/oauth/audit-log';
import { ACCESS_TOKEN_TTL } from '~/server/oauth/constants';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Token endpoint needs permissive CORS (called from third-party domains)
  const shouldStop = addCorsHeaders(req, res, ['POST']);
  if (shouldStop) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = req.body?.client_id ?? 'unknown';
  const ip = requestIp.getClientIp(req) ?? '';

  // Rate limit by client_id
  const allowed = await checkOAuthRateLimit(req, res, 'token', clientId);
  if (!allowed) return sendRateLimitResponse(res);

  try {
    const request = new Request({
      method: req.method,
      headers: req.headers as Record<string, string>,
      query: req.query as Record<string, string>,
      body: req.body,
    });

    const response = new Response(res);

    const token = await oauthServer.token(request, response);

    const grantType = req.body?.grant_type;
    logOAuthEvent({
      type: grantType === 'refresh_token' ? 'token.refreshed' : 'token.issued',
      userId: typeof token.user?.id === 'number' ? token.user.id : undefined,
      clientId,
      scope: token.scope
        ? parseInt(Array.isArray(token.scope) ? token.scope[0] : token.scope, 10)
        : undefined,
      ip,
    });

    return res.status(200).json({
      access_token: token.accessToken,
      token_type: 'Bearer',
      expires_in: token.accessTokenLifetime ?? ACCESS_TOKEN_TTL,
      refresh_token: token.refreshToken,
      scope: token.scope,
    });
  } catch (err: any) {
    const status = err.statusCode || err.code || 500;
    return res.status(typeof status === 'number' ? status : 500).json({
      error: err.name || 'server_error',
      error_description: err.message,
    });
  }
}
