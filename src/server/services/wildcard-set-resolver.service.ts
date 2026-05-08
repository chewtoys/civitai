import { dbRead } from '~/server/db/client';
import { parsePromptSnippetReferences } from '~/utils/prompt-helpers';

// Per-reference selections live on the workflow metadata under
// `params.snippets.targets[<targetKey>][i]`. `selections: []` = default to
// the full clean pool computed from wildcardSetIds. Non-empty entries opt
// into per-source narrowing: each entry says "from this source category,
// include these (`in`) and exclude these (`ex`)." Sources not mentioned in
// non-empty selections do NOT contribute to the pool.
export type SnippetSelectionEntry = {
  categoryId: number;
  in: string[];
  ex: string[];
};

export type SnippetReferenceSelection = {
  category: string;
  selections: SnippetSelectionEntry[];
};

// Mirrors the SnippetsNode shape from the workflow metadata (see schema doc
// §4.3). Kept narrow on purpose — anything else on the form's snippets node
// is irrelevant to expansion.
export type SnippetsPayload = {
  wildcardSetIds: number[];
  mode?: 'random' | 'batch';
  batchCount?: number;
  /**
   * Preview-only override. When the user clicks Preview the form sends a
   * sampled seed alongside the snippets node so the resolved combination is
   * deterministic and reproducible. NOT persisted to workflow metadata —
   * actual generation uses the form's top-level seed instead.
   */
  seed?: number;
  targets: Record<string, SnippetReferenceSelection[]>;
};

export type ExpansionStep = Record<string, string>;

export type ResolvedReference = {
  /** The original reference as it appeared in the template (preserves casing). */
  category: string;
  start: number;
  end: number;
  /** Lower-cased lookup key used to match against the case-insensitive pool map. */
  lookupKey: string;
};

export type ResolverDiagnostics = {
  /** Reference-categories that produced no pool — substituted with literal `#name` in the output. */
  unresolved: string[];
  /** Pool size per unique category-name across all targets, post-narrowing. */
  poolSizes: Record<string, number>;
  /** Cartesian total before sampling cap (batch mode only). */
  cartesianTotal?: number;
  /** Whether the cartesian was sampled down because it exceeded `batchCount`. */
  sampled?: boolean;
};

export type ExpandSnippetsResult = {
  expansions: ExpansionStep[];
  diagnostics: ResolverDiagnostics;
};

const DEFAULT_MODE: NonNullable<SnippetsPayload['mode']> = 'random';
const DEFAULT_BATCH_COUNT = 1;
const HARD_BATCH_CAP = 100;

/**
 * Top-level entry. Given a snippets node + the templates that reference it
 * (`prompt`, `negativePrompt`, future `musicDescription`, etc.) plus a
 * deterministic seed, produces N substituted target records — one per
 * workflow step the form wants to fan out into.
 *
 * Authorization is enforced inline against the loaded `wildcardSetIds`:
 * System-kind sets are public, User-kind sets must match `userId`. IDs that
 * fail the predicate are silently dropped (matches the resolver query in
 * schema doc §6.2 — the form may carry a stale id from localStorage).
 *
 * v1 scope: top-level `#category` references only. Tokens that appear inside
 * a category's value text (whether `#name` or `__name__`) are passed through
 * literally — nested resolution lands later.
 */
export async function expandSnippetsToTargets({
  snippets,
  targetTemplates,
  seed,
  userId,
}: {
  snippets: SnippetsPayload;
  targetTemplates: Record<string, string>;
  /** Source of randomness. Pass the form's resolved generation seed. */
  seed: number;
  userId: number;
}): Promise<ExpandSnippetsResult> {
  const mode = snippets.mode ?? DEFAULT_MODE;
  const batchCount = clampBatchCount(snippets.batchCount ?? DEFAULT_BATCH_COUNT);

  // 1. Parse references out of every target. Document order is preserved
  //    inside each target so substitution can walk back-to-front later.
  const referencesByTarget = new Map<string, ResolvedReference[]>();
  const uniqueLookupKeys = new Set<string>();
  for (const [targetKey, template] of Object.entries(targetTemplates)) {
    const refs = parsePromptSnippetReferences(template).map<ResolvedReference>((r) => ({
      ...r,
      lookupKey: r.category.toLowerCase(),
    }));
    referencesByTarget.set(targetKey, refs);
    for (const r of refs) uniqueLookupKeys.add(r.lookupKey);
  }

  // No references in any target → nothing to expand. Return the templates
  // verbatim once (or batchCount times if the caller is asking for fan-out
  // of identical results — which is mode 'batch' with no #refs, an edge case).
  if (uniqueLookupKeys.size === 0) {
    return {
      expansions: Array.from({ length: batchCount }, () => ({ ...targetTemplates })),
      diagnostics: { unresolved: [], poolSizes: {} },
    };
  }

  // 2. Bulk-fetch all category rows that match (a) any of the loaded sets the
  //    user is authorized for and (b) any of the referenced category names.
  //    Single round-trip across both targets.
  const categoryRows = await dbRead.wildcardSetCategory.findMany({
    where: {
      // TEMPORARY: relaxed to `{ not: 'Dirty' }` while the audit pipeline is
      // still being built. Without this, Pending (un-audited) categories
      // resolve to empty pools and Preview / expansion produce literal
      // `#name` output everywhere — making the dev form unusable. Dirty
      // stays excluded.
      // TODO(prompt-snippets-v1): tighten back to `'Clean'` once verdicts
      // are flowing. See prompt-snippets-v1.md.
      auditStatus: { not: 'Dirty' },
      name: { in: [...uniqueLookupKeys] }, // citext = case-insensitive
      wildcardSet: {
        id: { in: snippets.wildcardSetIds },
        isInvalidated: false,
        OR: [{ kind: 'System' }, { kind: 'User', ownerUserId: userId }],
      },
    },
    select: {
      id: true,
      name: true,
      values: true,
      wildcardSet: { select: { id: true, kind: true } },
    },
  });

  // Group sources per lookup key so per-reference resolution is O(1).
  const sourcesByLookupKey = new Map<string, { categoryId: number; values: string[] }[]>();
  for (const row of categoryRows) {
    const key = row.name.toLowerCase();
    let bucket = sourcesByLookupKey.get(key);
    if (!bucket) {
      bucket = [];
      sourcesByLookupKey.set(key, bucket);
    }
    bucket.push({ categoryId: row.id, values: row.values });
  }

  // 3. Compute the effective pool per (target, lookupKey). Selections live on
  //    the snippets payload and are keyed by category-name within their
  //    target slice — same `#character` reference in `prompt` and
  //    `negativePrompt` can have different selections.
  const poolsByTargetAndKey = new Map<string, string[]>();
  const diagnostics: ResolverDiagnostics = { unresolved: [], poolSizes: {} };

  for (const [targetKey, refs] of referencesByTarget) {
    const targetSelections = snippets.targets[targetKey] ?? [];
    const selectionsByLookupKey = new Map<string, SnippetSelectionEntry[]>();
    for (const entry of targetSelections) {
      selectionsByLookupKey.set(entry.category.toLowerCase(), entry.selections);
    }

    for (const ref of refs) {
      const cacheKey = `${targetKey}:${ref.lookupKey}`;
      if (poolsByTargetAndKey.has(cacheKey)) continue;
      const sources = sourcesByLookupKey.get(ref.lookupKey) ?? [];
      const selections = selectionsByLookupKey.get(ref.lookupKey) ?? [];
      const pool = computeEffectivePool(sources, selections);
      poolsByTargetAndKey.set(cacheKey, pool);
      diagnostics.poolSizes[cacheKey] = pool.length;
      if (pool.length === 0) diagnostics.unresolved.push(cacheKey);
    }
  }

  // 4. Sample. Mode determines how the pools turn into N step records.
  if (mode === 'random') {
    const expansions = sampleRandom({
      seed,
      batchCount,
      targetTemplates,
      referencesByTarget,
      poolsByTargetAndKey,
    });
    return { expansions, diagnostics };
  }

  // mode === 'batch'
  return sampleBatch({
    seed,
    batchCount,
    targetTemplates,
    referencesByTarget,
    poolsByTargetAndKey,
    diagnostics,
  });
}

function clampBatchCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BATCH_COUNT;
  return Math.max(1, Math.min(Math.floor(value), HARD_BATCH_CAP));
}

/**
 * Build the substitutable value list for one reference-category from its raw
 * source rows + the user's selection entries (if any). Empty selections
 * default to the full pool (union across sources). Non-empty selections opt
 * into per-source narrowing: only sources mentioned contribute, with their
 * own `in`/`ex` rules applied.
 */
function computeEffectivePool(
  sources: { categoryId: number; values: string[] }[],
  selections: SnippetSelectionEntry[]
): string[] {
  // Default full-pool path: union of every source's values, dedup-preserving order.
  if (selections.length === 0) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const source of sources) {
      for (const value of source.values) {
        if (!seen.has(value)) {
          seen.add(value);
          out.push(value);
        }
      }
    }
    return out;
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const sel of selections) {
    const source = sources.find((s) => s.categoryId === sel.categoryId);
    if (!source) continue; // source no longer exists for this user — silent drop
    const exSet = sel.ex.length > 0 ? new Set(sel.ex) : null;
    const inSet = sel.in.length > 0 ? new Set(sel.in) : null;
    for (const value of source.values) {
      if (inSet && !inSet.has(value)) continue;
      if (exSet && exSet.has(value)) continue;
      if (!seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
  }
  return out;
}

function sampleRandom({
  seed,
  batchCount,
  targetTemplates,
  referencesByTarget,
  poolsByTargetAndKey,
}: {
  seed: number;
  batchCount: number;
  targetTemplates: Record<string, string>;
  referencesByTarget: Map<string, ResolvedReference[]>;
  poolsByTargetAndKey: Map<string, string[]>;
}): ExpansionStep[] {
  const expansions: ExpansionStep[] = [];
  for (let stepIndex = 0; stepIndex < batchCount; stepIndex++) {
    const step: ExpansionStep = {};
    for (const [targetKey, template] of Object.entries(targetTemplates)) {
      const refs = referencesByTarget.get(targetKey) ?? [];
      // Per the product doc, repeated occurrences of the same category in
      // one step share the same random pick under random mode (consistent
      // with how a single random draw populates the prompt). Cache the
      // per-step pick by lookup key so all occurrences land on the same value.
      const pickByLookupKey = new Map<string, string>();
      for (const ref of refs) {
        if (pickByLookupKey.has(ref.lookupKey)) continue;
        const pool = poolsByTargetAndKey.get(`${targetKey}:${ref.lookupKey}`) ?? [];
        if (pool.length === 0) continue;
        const rng = mulberry32(mixSeed(seed, stepIndex, targetKey, ref.lookupKey));
        pickByLookupKey.set(ref.lookupKey, pool[Math.floor(rng() * pool.length)]);
      }
      step[targetKey] = substitute(template, refs, pickByLookupKey);
    }
    expansions.push(step);
  }
  return expansions;
}

function sampleBatch({
  seed,
  batchCount,
  targetTemplates,
  referencesByTarget,
  poolsByTargetAndKey,
  diagnostics,
}: {
  seed: number;
  batchCount: number;
  targetTemplates: Record<string, string>;
  referencesByTarget: Map<string, ResolvedReference[]>;
  poolsByTargetAndKey: Map<string, string[]>;
  diagnostics: ResolverDiagnostics;
}): ExpandSnippetsResult {
  // Cartesian variables = unique (target, lookupKey) pairs. Repeated
  // occurrences of the same category within one target use the same draw
  // under v1 — the no-repeat-across-slots rule is documented but deferred
  // until we have explicit slot-permutation semantics in the resolver.
  type Var = { targetKey: string; lookupKey: string; pool: string[] };
  const vars: Var[] = [];
  for (const [targetKey, refs] of referencesByTarget) {
    const seenKey = new Set<string>();
    for (const ref of refs) {
      if (seenKey.has(ref.lookupKey)) continue;
      seenKey.add(ref.lookupKey);
      const pool = poolsByTargetAndKey.get(`${targetKey}:${ref.lookupKey}`) ?? [];
      if (pool.length === 0) continue; // unresolved — won't constrain cartesian
      vars.push({ targetKey, lookupKey: ref.lookupKey, pool });
    }
  }

  // Total cartesian = product of pool sizes. Use BigInt to avoid overflow
  // in pathological cases (10^15 combinations is feasible with a few
  // mid-size pools); we never enumerate more than batchCount entries
  // anyway — the BigInt is just for the diagnostics field.
  const cartesianTotal = vars.reduce((acc, v) => acc * BigInt(v.pool.length), BigInt(1));
  const safeTotal =
    cartesianTotal > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(cartesianTotal);
  diagnostics.cartesianTotal = safeTotal;

  // No reference-vars — degenerate batch (templates have no #refs). Replicate
  // the templates batchCount times so the caller still gets the expected
  // step count.
  if (vars.length === 0 || cartesianTotal === BigInt(0)) {
    const expansions = Array.from({ length: batchCount }, () => ({ ...targetTemplates }));
    return { expansions, diagnostics };
  }

  // Strategy: when batchCount >= cartesianTotal, enumerate every combination
  // (ordered by index 0..total-1, deterministic). When batchCount < total,
  // pick batchCount distinct indices via a seeded reservoir-style sample.
  const total = cartesianTotal;
  const selectedIndices: bigint[] =
    BigInt(batchCount) >= total
      ? Array.from({ length: Number(total) }, (_, i) => BigInt(i))
      : seededDistinctIndices(seed, total, batchCount);
  diagnostics.sampled = BigInt(batchCount) < total;

  const expansions: ExpansionStep[] = selectedIndices.map((idx) => {
    const pickByCacheKey = new Map<string, string>();
    let remainder = idx;
    // Walk vars in insertion order, peeling one digit at a time in mixed-radix.
    for (const v of vars) {
      const base = BigInt(v.pool.length);
      const digit = Number(remainder % base);
      remainder = remainder / base;
      pickByCacheKey.set(`${v.targetKey}:${v.lookupKey}`, v.pool[digit]);
    }

    const step: ExpansionStep = {};
    for (const [targetKey, template] of Object.entries(targetTemplates)) {
      const refs = referencesByTarget.get(targetKey) ?? [];
      const pickByLookupKey = new Map<string, string>();
      for (const ref of refs) {
        if (pickByLookupKey.has(ref.lookupKey)) continue;
        const pick = pickByCacheKey.get(`${targetKey}:${ref.lookupKey}`);
        if (pick !== undefined) pickByLookupKey.set(ref.lookupKey, pick);
      }
      step[targetKey] = substitute(template, refs, pickByLookupKey);
    }
    return step;
  });

  return { expansions, diagnostics };
}

/**
 * Deterministically choose `count` distinct indices from `[0, total)` using a
 * seeded PRNG. Uses Floyd's algorithm (O(count) memory, O(count) time) which
 * is correct for `count <= total` even when `total` is huge — doesn't
 * allocate a `total`-sized backing array.
 */
function seededDistinctIndices(seed: number, total: bigint, count: number): bigint[] {
  const rng = mulberry32(seed);
  const chosen = new Set<string>();
  const out: bigint[] = [];
  // Floyd's: for j = total - count .. total - 1, pick t in [0..j], add t if
  // unseen otherwise add j. Adapted to BigInt for the j range.
  const start = total - BigInt(count);
  for (let i = BigInt(0); i < BigInt(count); i++) {
    const j = start + i;
    // Pick t in [0..j] inclusive — bigint range, sample via PRNG bits.
    const t = randomBigInt(rng, j + BigInt(1));
    const tKey = t.toString();
    const jKey = j.toString();
    if (chosen.has(tKey)) {
      chosen.add(jKey);
      out.push(j);
    } else {
      chosen.add(tKey);
      out.push(t);
    }
  }
  return out;
}

/** Sample a uniform bigint in [0, max) using a 32-bit PRNG. */
function randomBigInt(rng: () => number, max: bigint): bigint {
  const ZERO = BigInt(0);
  const ONE = BigInt(1);
  const TWO_32 = BigInt(0x100000000);
  const U32_MAX = BigInt(0xffffffff);
  if (max <= ZERO) return ZERO;
  if (max <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return BigInt(Math.floor(rng() * Number(max)));
  }
  // For larger ranges, fold multiple 32-bit draws together. Acceptable bias
  // for a creative-tooling sampling context — we're not generating crypto.
  let acc = ZERO;
  let mult = ONE;
  let remaining = max;
  while (remaining > ONE) {
    const chunk = remaining > U32_MAX ? TWO_32 : remaining;
    const draw = BigInt(Math.floor(rng() * Number(chunk)));
    acc += draw * mult;
    mult *= chunk;
    remaining = remaining / chunk;
  }
  return acc % max;
}

/**
 * Replace each reference range in `template` with the picked value for its
 * lookup key. Walks back-to-front so earlier replacements don't invalidate
 * the start/end indices of later ones. References whose lookup key has no
 * pick (unresolved or out-of-pool) are left as their original `#name` text.
 */
function substitute(
  template: string,
  refs: ResolvedReference[],
  pickByLookupKey: Map<string, string>
): string {
  if (refs.length === 0) return template;
  let out = template;
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i];
    const value = pickByLookupKey.get(ref.lookupKey);
    if (value === undefined) continue; // leave the `#name` literal in place
    out = out.slice(0, ref.start) + value + out.slice(ref.end);
  }
  return out;
}

/**
 * Mix four inputs into a single 32-bit seed. Deterministic and stable —
 * same inputs always produce the same number — so the resolver's output is
 * fully reproducible from `(seed, stepIndex, targetKey, lookupKey)`.
 */
function mixSeed(seed: number, stepIndex: number, targetKey: string, lookupKey: string): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = imul32(h ^ stepIndex, 0x85ebca6b);
  h = imul32(h ^ stringHash(targetKey), 0xc2b2ae35);
  h = imul32(h ^ stringHash(lookupKey), 0x27d4eb2f);
  return h | 0;
}

function stringHash(s: string): number {
  // FNV-1a 32-bit. Cheap, good-enough distribution for seeding a PRNG.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = imul32(h, 0x01000193);
  }
  return h | 0;
}

function imul32(a: number, b: number): number {
  return Math.imul(a, b);
}

/**
 * Mulberry32 — 32-bit PRNG. Tiny, deterministic, well-distributed for our
 * use case (sampling from small int ranges). Returns a function that
 * yields uniform doubles in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
