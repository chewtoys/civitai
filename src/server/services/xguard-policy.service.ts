import crypto from 'crypto';
import { REDIS_SYS_KEYS, sysRedis } from '~/server/redis/client';
import type { XGuardMode } from '~/server/schema/xguard-policy.schema';

const HASH_ALGO = 'sha256';
const HASH_LENGTH = 8;
const HASH_PREFIX = `${HASH_ALGO}-${HASH_LENGTH}`;

export type XGuardPolicyEntry = {
  label: string;
  policy: string;
  threshold: number;
  action: string;
  policyHash: string;
  updatedAt: string;
  updatedBy: number;
};

function getRedisKey(mode: XGuardMode) {
  return mode === 'text'
    ? REDIS_SYS_KEYS.XGUARD.POLICIES_TEXT
    : REDIS_SYS_KEYS.XGUARD.POLICIES_PROMPT;
}

/**
 * Self-describing hash format: `sha256-8:<8 hex chars>`. Prefix lets us change
 * the algorithm or length later without backfilling — old entries identify
 * their own scheme.
 */
export function computePolicyHash(policy: string) {
  const fullHash = crypto.createHash(HASH_ALGO).update(policy, 'utf8').digest('hex');
  return `${HASH_PREFIX}:${fullHash.slice(0, HASH_LENGTH)}`;
}

export async function listPolicies(mode: XGuardMode): Promise<XGuardPolicyEntry[]> {
  const key = getRedisKey(mode);
  const all = await sysRedis.hGetAll(key);
  return Object.values(all)
    .map((v) => {
      try {
        return JSON.parse(v) as XGuardPolicyEntry;
      } catch {
        return null;
      }
    })
    .filter((x): x is XGuardPolicyEntry => x !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function getPolicy(
  mode: XGuardMode,
  label: string
): Promise<XGuardPolicyEntry | null> {
  const key = getRedisKey(mode);
  const value = await sysRedis.hGet(key, label);
  if (!value) return null;
  return JSON.parse(value) as XGuardPolicyEntry;
}

/**
 * Batch-fetch policies for many labels at once. Returns a map keyed by label
 * with undefined for labels that have no Redis entry. Used by
 * `createXGuardModerationRequest` to build `labelOverrides`.
 */
export async function getPolicies(
  mode: XGuardMode,
  labels: string[]
): Promise<Record<string, XGuardPolicyEntry | undefined>> {
  const result: Record<string, XGuardPolicyEntry | undefined> = {};
  if (labels.length === 0) return result;
  const key = getRedisKey(mode);
  const values = await sysRedis.hmGet(key, labels);
  for (let i = 0; i < labels.length; i++) {
    const raw = values[i];
    result[labels[i]] = raw ? (JSON.parse(raw) as XGuardPolicyEntry) : undefined;
  }
  return result;
}

export async function upsertPolicy(
  mode: XGuardMode,
  input: { label: string; policy: string; threshold: number; action: string },
  userId: number
): Promise<XGuardPolicyEntry> {
  const key = getRedisKey(mode);
  const entry: XGuardPolicyEntry = {
    label: input.label,
    policy: input.policy,
    threshold: input.threshold,
    action: input.action,
    policyHash: computePolicyHash(input.policy),
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };
  await sysRedis.hSet(key, input.label, JSON.stringify(entry));
  return entry;
}

export async function deletePolicy(mode: XGuardMode, label: string) {
  const key = getRedisKey(mode);
  await sysRedis.hDel(key, label);
}
