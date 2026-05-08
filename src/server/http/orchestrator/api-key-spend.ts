import { env } from '~/env/server';

/**
 * Civitai → orchestrator helpers for per-subject buzz spend tracking.
 *
 * The orchestrator owns spend enforcement and rolling-window math. Civitai
 * stores limits, exposes them on /api/v1/me, invalidates the orchestrator's
 * cache when a limit changes, and reads spend back per subject for UI
 * display.
 *
 * A "subject" is an opaque (type, id) pair from the orchestrator's POV:
 *  - `apiKey` + numeric ApiKey.id   — for User-type API keys
 *  - `oauth`  + clientId (string)   — for OAuth-issued tokens (the consent
 *                                     is the stable identifier across
 *                                     access-token rotations)
 *
 * Endpoints (Koen, 2026-05-07):
 *
 *   GET    /v1/manager/users/:userId/limits/auth/:type/:id
 *     →   { ...spend / budget data for this subject }
 *     404 → no spend / limit data for this subject (treat as zero)
 *
 *   DELETE /v1/manager/users/:userId/limits/auth/:type/:id
 *     →   204 — invalidates the orchestrator's cache for this subject
 *
 * Auth: bearer with `ORCHESTRATOR_ACCESS_TOKEN` (the same Civitai system key
 * used by other `/v1/manager/*` integrations like flagged-consumers).
 */

import type { Subject, SubjectType } from '~/server/schema/api-key.schema';
export type { Subject, SubjectType };

const baseUrl = () => env.ORCHESTRATOR_ENDPOINT ?? '';

function authPath(userId: number, subject: Subject) {
  return `/v1/manager/users/${userId}/limits/auth/${subject.type}/${encodeURIComponent(
    String(subject.id)
  )}`;
}

function subjectPath(userId: number, subject: Subject) {
  return `/v1/manager/users/${userId}/auth/${subject.type}/${encodeURIComponent(
    String(subject.id)
  )}`;
}

async function orchestratorFetch(path: string, init?: RequestInit) {
  if (!env.ORCHESTRATOR_ENDPOINT || !env.ORCHESTRATOR_ACCESS_TOKEN) {
    throw new Error('Orchestrator endpoint or access token not configured');
  }
  const url = `${baseUrl()}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.ORCHESTRATOR_ACCESS_TOKEN}`,
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
  };
  return fetch(url, { ...init, headers: { ...headers, ...init?.headers } });
}

/**
 * Invalidate the orchestrator's cached limit for a subject. Called when the
 * user edits the buzz limit on a key or connected app so the next request
 * from that subject re-fetches via /api/v1/me.
 */
export async function bustBuzzLimitCache(args: {
  userId: number;
  subject: Subject;
}): Promise<void> {
  const response = await orchestratorFetch(authPath(args.userId, args.subject), {
    method: 'DELETE',
  });
  // 404 is fine — nothing to invalidate. Other non-2xx is a real error.
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Orchestrator DELETE limits/auth failed: ${response.status} ${response.statusText}`
    );
  }
}

export type BuzzSpendBucket = { ts: string; amount: number };

/**
 * Per-subject spend snapshot returned by the orchestrator. Shape echoed back
 * to the UI: type + id locate the subject; spend is the total in the current
 * tracked window(s); buckets are the ts/amount pairs for charting.
 */
export type BuzzSpendEntry = {
  type: SubjectType;
  id: number | string;
  spend: number;
  buckets: BuzzSpendBucket[];
};

/**
 * Fetch the orchestrator's spend snapshot for a single subject. Returns null
 * on 404 (no spend / no limit tracked yet) so the caller can treat absence
 * uniformly with empty results.
 */
export async function getBuzzLimitForSubject(args: {
  userId: number;
  subject: Subject;
}): Promise<BuzzSpendEntry | null> {
  const response = await orchestratorFetch(authPath(args.userId, args.subject));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Orchestrator GET limits/auth failed: ${response.status} ${response.statusText}`
    );
  }
  const body = (await response.json()) as Partial<BuzzSpendEntry>;
  return {
    type: args.subject.type,
    id: args.subject.id,
    spend: body.spend ?? 0,
    buckets: body.buckets ?? [],
  };
}

/**
 * Fan-out fetch — one GET per subject, in parallel, swallow individual
 * failures so a single orchestrator hiccup doesn't blank the whole UI.
 *
 * Confirmed with Koen 2026-05-07: no batched list endpoint coming. He stores
 * subjects in Mongo with no deletion policy, so a list response would return
 * stale entries Civitai has forgotten about. Civitai is the source of truth
 * for which subjects exist; per-subject GETs are simpler and just as fast.
 * Caller is expected to filter the subject list to ones with limits set
 * before calling, so unlimited keys/consents don't generate 404 traffic.
 */
export async function getBuzzSpendForSubjects(
  userId: number,
  subjects: Subject[]
): Promise<BuzzSpendEntry[]> {
  const results = await Promise.all(
    subjects.map((subject) => getBuzzLimitForSubject({ userId, subject }).catch(() => null))
  );
  return results.filter((r): r is BuzzSpendEntry => r !== null);
}

/**
 * Delete the orchestrator's stored record for a subject — called when the
 * user deletes the underlying API key (so the subject is gone) or revokes a
 * connected app (so the OAuth consent is gone). Best-effort: 404 means
 * already absent, anything else is logged but doesn't fail the user
 * mutation.
 *
 * Endpoint (Koen, 2026-05-07):
 *   DELETE /v1/manager/users/:userId/auth/:type/:id
 *     →   204 — subject removed (or never existed)
 */
export async function deleteAuthSubject(args: { userId: number; subject: Subject }): Promise<void> {
  const response = await orchestratorFetch(subjectPath(args.userId, args.subject), {
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Orchestrator DELETE auth subject failed: ${response.status} ${response.statusText}`
    );
  }
}
