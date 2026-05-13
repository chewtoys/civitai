import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as z from 'zod';

// Minimal NextApiRequest/Response stand-in (avoids node-mocks-http dependency).
function createMocks({
  method = 'POST',
  headers = {},
  body = {},
  query = {},
}: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}) {
  const req = { method, headers, body, query } as unknown as Record<string, unknown>;
  let statusCode = 200;
  let payload: unknown = undefined;
  const responseHeaders: Record<string, string> = {};
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      payload = body;
      return res;
    },
    setHeader(key: string, value: string) {
      responseHeaders[key] = value;
    },
    end() {
      return res;
    },
    _getStatusCode: () => statusCode,
    _getJSONData: () => payload,
    _getHeaders: () => responseHeaders,
  };
  return { req, res };
}

// --- Hoisted mocks ---
const { mockGetSession, mockRedis, mockEnv, mockRetoolAudit } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRedis: {
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60),
  },
  mockEnv: { SUPER_ADMIN_USER_IDS: [42] as number[] },
  mockRetoolAudit: vi.fn(),
}));

vi.mock('~/env/server', () => ({ env: mockEnv }));
vi.mock('~/server/auth/bearer-token', () => ({
  getSessionFromBearerToken: mockGetSession,
}));
vi.mock('~/server/redis/client', () => ({
  sysRedis: mockRedis,
  REDIS_SYS_KEYS: { RETOOL_ENDPOINT: { RATE_LIMIT: 'retool-endpoint:rate-limit' } },
}));
vi.mock('~/server/clickhouse/client', () => ({
  Tracker: class {
    retoolAudit = mockRetoolAudit;
  },
}));
vi.mock('@civitai/next-axiom', () => ({
  withAxiom: (fn: unknown) => fn,
}));
// Short-circuit the endpoint-helpers import chain so we don't pull in the full
// Prisma + axiom + auth dependency tree during the unit test.
vi.mock('~/server/utils/endpoint-helpers', () => ({
  handleEndpointError: (res: { status: (n: number) => { json: (b: unknown) => unknown } }, e: unknown) =>
    res.status(500).json({ error: 'An unexpected error occurred', message: (e as Error).message }),
}));

import {
  defineRetoolEndpoint,
  retoolAction,
} from '~/server/utils/retool-endpoint';

function buildHandler(handlerSpy = vi.fn().mockResolvedValue({ ok: true })) {
  return {
    handler: defineRetoolEndpoint('test', {
      ping: retoolAction({
        input: z.object({ value: z.coerce.number().int() }),
        rateLimit: { max: 5, windowSeconds: 60 },
        async handler(input, ctx) {
          return handlerSpy(input, ctx);
        },
      }),
      privilegedPing: retoolAction({
        input: z.object({ value: z.coerce.number().int() }),
        privileged: true,
        rateLimit: { max: 5, windowSeconds: 60 },
        async handler(input, ctx) {
          return handlerSpy(input, ctx);
        },
      }),
    }),
    handlerSpy,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.incr.mockResolvedValue(1);
  mockRedis.ttl.mockResolvedValue(60);
  mockEnv.SUPER_ADMIN_USER_IDS = [42];
});

describe('defineRetoolEndpoint', () => {
  it('returns 405 for non-POST methods', async () => {
    const { handler } = buildHandler();
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(405);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const { handler } = buildHandler();
    const { req, res } = createMocks({ method: 'POST', body: {} });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(401);
  });

  it('returns 401 when bearer token does not resolve to a session', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const { handler } = buildHandler();
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer bad-key' },
      body: { action: 'ping', value: 1 },
    });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(401);
  });

  it('returns 403 when the user is not a moderator', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 99, isModerator: false },
    });
    const { handler } = buildHandler();
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer key' },
      body: { action: 'ping', value: 1 },
    });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(403);
  });

  it('returns 400 for an unknown action', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 7, isModerator: true },
    });
    const { handler } = buildHandler();
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer key' },
      body: { action: 'doesNotExist', value: 1 },
    });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 400 when the payload fails the action schema', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 7, isModerator: true },
    });
    const { handler } = buildHandler();
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer key' },
      body: { action: 'ping', value: 'not-a-number' },
    });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(400);
  });

  it('rejects privileged actions when the actor is not super-admin', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 7, isModerator: true },
    });
    const { handler, handlerSpy } = buildHandler();
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer key' },
      body: { action: 'privilegedPing', value: 1 },
    });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(403);
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('allows privileged actions for super-admin actors and emits an audit row', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 42, isModerator: true },
    });
    const { handler, handlerSpy } = buildHandler(
      vi.fn().mockResolvedValue({ affected: { userIds: [1] }, value: 7 })
    );
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer key' },
      body: { action: 'privilegedPing', value: 1 },
    });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(200);
    expect(handlerSpy).toHaveBeenCalledOnce();
    expect(mockRetoolAudit).toHaveBeenCalledOnce();
    const auditCall = mockRetoolAudit.mock.calls[0][0];
    expect(auditCall.action).toBe('test.privilegedPing');
    expect(auditCall.privileged).toBe(true);
    expect(auditCall.outcome).toBe('ok');
    expect(auditCall.affected).toEqual({ userIds: [1] });
  });

  it('returns 429 when the per-action rate limit is exceeded', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 7, isModerator: true },
    });
    mockRedis.incr.mockResolvedValueOnce(99); // above max=5
    const { handler, handlerSpy } = buildHandler();
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer key' },
      body: { action: 'ping', value: 1 },
    });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(429);
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('emits an error audit row when the handler throws', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 7, isModerator: true },
    });
    const { handler } = buildHandler(
      vi.fn().mockRejectedValueOnce(new Error('boom'))
    );
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer key' },
      body: { action: 'ping', value: 1 },
    });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(500);
    expect(mockRetoolAudit).toHaveBeenCalledOnce();
    const auditCall = mockRetoolAudit.mock.calls[0][0];
    expect(auditCall.outcome).toBe('error');
    expect(auditCall.errorMsg).toBe('boom');
  });
});
