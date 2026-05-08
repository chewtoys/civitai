import type {
  AuthorizationCode,
  Client,
  RefreshToken,
  Token,
  User,
} from '@node-oauth/oauth2-server';
import { createHash, timingSafeEqual } from 'crypto';
import { dbRead, dbWrite } from '~/server/db/client';
import { redis, REDIS_KEYS } from '~/server/redis/client';
import { generateSecretHash } from '~/server/utils/key-generator';
import { Flags } from '~/shared/utils/flags';
import { TokenScope } from '~/shared/constants/token-scope.constants';
import { ACCESS_TOKEN_TTL, AUTH_CODE_TTL, REFRESH_TOKEN_TTL } from './constants';
import { createOAuthTokenPair } from './token-helpers';

/** Hash auth code for Redis storage (separate from API key hashing) */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Convert scope bitmask to/from the library's string-based scope */
function scopeToString(scope: number): string[] {
  return [scope.toString()];
}

function stringToScope(scope: string | string[] | undefined): number {
  if (!scope) return 0;
  const str = Array.isArray(scope) ? scope[0] : scope;
  const parsed = parseInt(str, 10);
  if (isNaN(parsed) || parsed < 0 || parsed > TokenScope.Full) return 0;
  return parsed;
}

// Combined model interface — the library accepts any object with these methods
export const oauthModel = {
  // ─── Client ─────────────────────────────────────────────────

  async getClient(clientId: string, clientSecret: string | null): Promise<Client | false> {
    const client = await dbRead.oauthClient.findUnique({ where: { id: clientId } });
    if (!client) return false;

    // The library passes `null` from the authorize handler (client_secret is not
    // sent on /authorize per OAuth spec) and a string (or undefined) from the
    // token handler. Only validate the secret when the library actually had one
    // to pass — i.e. the token-endpoint code path.
    if (clientSecret !== null) {
      if (client.isConfidential) {
        if (!clientSecret || !client.secret) return false;
        const hashedSecret = generateSecretHash(clientSecret);
        if (!timingSafeEqual(Buffer.from(hashedSecret), Buffer.from(client.secret))) return false;
      }
    }

    return {
      id: client.id,
      grants: client.grants,
      redirectUris: client.redirectUris,
      accessTokenLifetime: ACCESS_TOKEN_TTL,
      refreshTokenLifetime: REFRESH_TOKEN_TTL,
      allowedScopes: client.allowedScopes,
      isConfidential: client.isConfidential,
    } as Client;
  },

  // ─── Authorization Code ─────────────────────────────────────

  async saveAuthorizationCode(
    code: AuthorizationCode,
    client: Client,
    user: User
  ): Promise<AuthorizationCode> {
    const hashedCode = hashCode(code.authorizationCode);
    const scopeValue = Array.isArray(code.scope) ? code.scope[0] : String(code.scope ?? '0');

    const data = {
      clientId: client.id,
      userId: user.id,
      scope: scopeValue,
      redirectUri: code.redirectUri,
      codeChallenge: code.codeChallenge,
      codeChallengeMethod: code.codeChallengeMethod,
      expiresAt: code.expiresAt.toISOString(),
    };

    await redis.packed.hSet(REDIS_KEYS.OAUTH.AUTHORIZATION_CODES, hashedCode, data);
    await redis.hExpire(REDIS_KEYS.OAUTH.AUTHORIZATION_CODES, hashedCode, AUTH_CODE_TTL);

    return { ...code, client, user };
  },

  async getAuthorizationCode(authorizationCode: string): Promise<AuthorizationCode | false> {
    const hashedCode = hashCode(authorizationCode);
    const data = await redis.packed.hGet<{
      clientId: string;
      userId: number;
      scope: string;
      redirectUri: string;
      codeChallenge?: string;
      codeChallengeMethod?: string;
      expiresAt: string;
    }>(REDIS_KEYS.OAUTH.AUTHORIZATION_CODES, hashedCode);

    if (!data) return false;

    const client = await dbRead.oauthClient.findUnique({ where: { id: data.clientId } });
    if (!client) return false;

    return {
      authorizationCode,
      expiresAt: new Date(data.expiresAt),
      redirectUri: data.redirectUri,
      scope: [data.scope],
      codeChallenge: data.codeChallenge,
      codeChallengeMethod: data.codeChallengeMethod,
      client: { id: client.id, grants: client.grants, redirectUris: client.redirectUris } as Client,
      user: { id: data.userId },
    } as unknown as AuthorizationCode;
  },

  async revokeAuthorizationCode(code: AuthorizationCode): Promise<boolean> {
    const hashedCode = hashCode(code.authorizationCode);
    await redis.hDel(REDIS_KEYS.OAUTH.AUTHORIZATION_CODES, hashedCode);
    return true;
  },

  // ─── Tokens ─────────────────────────────────────────────────

  async saveToken(token: Token, client: Client, user: User): Promise<Token> {
    const scope = stringToScope(token.scope as unknown as string);

    const pair = await createOAuthTokenPair(user.id, client.id, scope);

    return {
      accessToken: pair.accessToken,
      accessTokenExpiresAt: pair.accessTokenExpiresAt,
      refreshToken: pair.refreshToken,
      refreshTokenExpiresAt: pair.refreshTokenExpiresAt,
      scope: scopeToString(scope),
      client,
      user,
    } as Token;
  },

  async getAccessToken(accessToken: string): Promise<Token | false> {
    const hash = generateSecretHash(accessToken);
    const now = new Date();

    const apiKey = await dbRead.apiKey.findFirst({
      where: {
        key: hash,
        type: 'Access',
        OR: [{ expiresAt: { gte: now } }, { expiresAt: null }],
      },
      select: { userId: true, tokenScope: true, expiresAt: true, clientId: true },
    });

    if (!apiKey) return false;

    return {
      accessToken,
      accessTokenExpiresAt: apiKey.expiresAt ?? undefined,
      scope: scopeToString(apiKey.tokenScope),
      client: { id: apiKey.clientId ?? '' } as Client,
      user: { id: apiKey.userId },
    } as unknown as Token;
  },

  async getRefreshToken(refreshToken: string): Promise<RefreshToken | false> {
    const hash = generateSecretHash(refreshToken);
    const now = new Date();

    const apiKey = await dbRead.apiKey.findFirst({
      where: {
        key: hash,
        type: 'Refresh',
        OR: [{ expiresAt: { gte: now } }, { expiresAt: null }],
      },
      select: { userId: true, tokenScope: true, expiresAt: true, clientId: true },
    });

    if (!apiKey) return false;

    return {
      refreshToken,
      refreshTokenExpiresAt: apiKey.expiresAt ?? undefined,
      scope: scopeToString(apiKey.tokenScope),
      client: { id: apiKey.clientId ?? '' } as Client,
      user: { id: apiKey.userId },
    } as unknown as RefreshToken;
  },

  async revokeToken(token: RefreshToken): Promise<boolean> {
    const hash = generateSecretHash(token.refreshToken);
    const deleted = await dbWrite.apiKey.deleteMany({ where: { key: hash, type: 'Refresh' } });

    // Also revoke all access tokens for this client+user
    if (token.client?.id && token.user?.id) {
      await dbWrite.apiKey.deleteMany({
        where: {
          clientId: token.client.id,
          userId:
            typeof token.user.id === 'number' ? token.user.id : parseInt(String(token.user.id)),
          type: 'Access',
        },
      });
    }

    return deleted.count > 0;
  },

  // ─── Client Credentials ─────────────────────────────────────

  async getUserFromClient(client: Client): Promise<User | false> {
    // For client_credentials grant, the "user" is the client owner
    const oauthClient = await dbRead.oauthClient.findUnique({
      where: { id: client.id },
      select: { userId: true, grants: true },
    });

    if (!oauthClient || !oauthClient.grants.includes('client_credentials')) {
      return false;
    }

    return { id: oauthClient.userId };
  },

  // ─── Scope Validation ──────────────────────────────────────

  async validateScope(_user: User, client: Client, scope: string[]): Promise<string[] | false> {
    const requestedScope = stringToScope(scope);
    const allowedScopes = (client as any).allowedScopes ?? TokenScope.Full;

    if (!Flags.hasFlag(allowedScopes, requestedScope)) {
      return false;
    }

    return scopeToString(requestedScope);
  },

  async verifyScope(token: Token, scope: string | string[]): Promise<boolean> {
    const tokenScope = stringToScope(token.scope as unknown as string);
    const requiredScope = stringToScope(scope as unknown as string);
    return Flags.hasFlag(tokenScope, requiredScope);
  },
};
