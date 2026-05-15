import type { XGuardModerationOutput } from '@civitai/client';
import type { Prisma } from '@prisma/client';
import { env } from '~/env/server';
import { dbRead, dbWrite } from '~/server/db/client';
import { logToAxiom } from '~/server/logging/client';
import {
  hashContent,
  recordEntityModerationFailure,
  recordEntityModerationSuccess,
  upsertEntityModerationPending,
} from '~/server/services/entity-moderation.service';
import { createXGuardModerationRequest } from '~/server/services/orchestrator/orchestrator.service';
import {
  EntityModerationStatus,
  WildcardSetAuditStatus,
  WildcardSetCategoryAuditStatus,
} from '~/shared/utils/prisma/enums';

// Entity type stamped onto every wildcard-category audit workflow's metadata
// via `createXGuardModerationRequest`. The webhook reads this (plus the
// `?type=wildcardCategoryValue` query param on the callback URL) to dispatch
// to the wildcard handler instead of the default entity-moderation flow.
const WILDCARD_CATEGORY_ENTITY_TYPE = 'WildcardSetCategory';

// XGuard labels that flip a category to Dirty when triggered. These are the
// hard-fail policy violations — content matching any of these is unusable
// regardless of site context. `csam` isn't in this list because XGuard's
// text classifiers don't ship a dedicated CSAM label; instead the verdict
// path treats a `young` + `sexual` co-trigger from the level-label set as
// synthetic CSAM and flips the category Dirty.
const WILDCARD_AUDIT_FAIL_LABELS = [
  'urine',
  'diaper',
  'scat',
  'menstruation',
  'bestiality',
] as const;
const FAIL_LABEL_SET = new Set<string>(WILDCARD_AUDIT_FAIL_LABELS);

// XGuard label(s) that classify content severity. Restricted to `nsfw` for
// now — the fine-grained `pg/pg13/r/x/xxx` evaluators aren't well-tuned for
// text yet, and pasting them in would just produce noisy classifications.
// Triggering any of these labels flips the category's `nsfw` boolean to
// true; nothing finer is recorded. If/when XGuard's text classifiers can
// reliably bucket severity, we can switch to a bitwise nsfwLevel column —
// for now boolean is the only honest representation.
const WILDCARD_AUDIT_LEVEL_LABELS = ['nsfw', 'young', 'sexual'] as const;
const LEVEL_LABEL_SET = new Set<string>(WILDCARD_AUDIT_LEVEL_LABELS);

// Discriminator on the shared text-moderation callback URL so this subsystem's
// results don't bleed into the entity-moderation flow used by Articles.
const CALLBACK_TYPE = 'wildcardCategoryValue';

// Max consecutive terminal failures (failed/expired/canceled) before we give
// up on a category. Cron skips over Pending rows whose retryCount has hit
// this so a permanently broken submission doesn't loop forever. Reset on a
// successful audit.
const MAX_RETRY = 5;

// Open-ended container persisted on `WildcardSetCategory.metadata`. Treat
// unknown fields as additive — readers should default missing fields rather
// than assume their presence.
export type WildcardCategoryMetadata = {
  // Active orchestrator workflow ID. Set on submission, cleared on terminal
  // callback. Cron treats absence as "needs (re)submission."
  workflowId?: string;
  // XGuard matched terms (union of `matchedTerms.text` across triggered
  // labels). Survives after rollup so a moderator viewing a Dirty category
  // can see exactly what triggered. Empty/omitted for Clean categories.
  triggeredTerms?: string[];
  // XGuard triggered labels (mirror of the moderation step output, kept on
  // the metadata so the JSON is self-describing without joining other rows).
  triggeredLabels?: string[];
  // Increments on each terminal failure. Cleared/reset implicitly on the
  // next successful rollup.
  retryCount?: number;
};

function buildCallbackUrl(): string {
  const base =
    env.TEXT_MODERATION_CALLBACK ??
    `${env.NEXTAUTH_URL}/api/webhooks/text-moderation-result?token=${env.WEBHOOK_TOKEN}`;
  // URL-aware concat: `TEXT_MODERATION_CALLBACK` may already include `?token`,
  // so we let URL.searchParams handle the `?` vs `&` choice instead of
  // string-templating it.
  const url = new URL(base);
  url.searchParams.set('type', CALLBACK_TYPE);
  return url.toString();
}

/**
 * Submit one wildcard category for XGuard audit via the shared
 * `createXGuardModerationRequest` helper. The category's `values` are joined
 * with newlines into the text payload; `entityType` / `entityId` flow through
 * the helper onto workflow metadata so the webhook can look the category up.
 * The callback URL carries `?type=wildcardCategoryValue` so the webhook
 * dispatches to the wildcard handler instead of the default entity-moderation
 * flow (Wildcards have their own audit table, not EntityModeration).
 *
 * The workflow ID is stamped onto `category.metadata.workflowId` so:
 *   - the cron can tell what's in flight,
 *   - stale callbacks (from a previous workflow that got superseded by a
 *     newer mutation) get rejected in `applyWildcardCategoryAuditSuccess`.
 *
 * Returns the workflow ID on a successful submission. Returns `null` when:
 *   - the category no longer exists,
 *   - the category has no values (caller should mark Clean directly),
 *   - the orchestrator submission silently failed (caller may retry on the
 *     next cron tick).
 */
export async function submitWildcardCategoryAudit(categoryId: number): Promise<string | null> {
  const category = await dbRead.wildcardSetCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, values: true },
  });
  if (!category) return null;
  if (!category.values || category.values.length === 0) return null;

  const text = category.values.join('\n');
  const contentHash = hashContent(text);

  // Persist an EntityModeration row Pending BEFORE submitting so a silent
  // orchestrator failure still leaves a row for `retry-failed-text-moderation`
  // to pick up. Mirrors the pattern in `submitTextModeration` for Article.
  // The row is keyed on (entityType, entityId) which matches what the webhook
  // will use to find it via the workflow metadata.
  await upsertEntityModerationPending({
    entityType: WILDCARD_CATEGORY_ENTITY_TYPE,
    entityId: categoryId,
    workflowId: null,
    contentHash,
  });

  // Submit both fail labels (hard policy violations → Dirty) and level
  // labels (currently just `nsfw` → boolean `nsfw = true`). We ignore
  // XGuard's top-level `blocked` field in the callback and recompute Dirty
  // ourselves from per-label results, so including level labels here can't
  // accidentally flip the audit verdict.
  const workflow = await createXGuardModerationRequest({
    mode: 'text',
    entityType: WILDCARD_CATEGORY_ENTITY_TYPE,
    entityId: categoryId,
    content: text,
    labels: [...WILDCARD_AUDIT_FAIL_LABELS, ...WILDCARD_AUDIT_LEVEL_LABELS],
    priority: 'low',
    callbackUrl: buildCallbackUrl(),
  });

  if (!workflow?.id) {
    logToAxiom({
      type: 'error',
      name: 'wildcard-category-audit',
      message: 'createXGuardModerationRequest returned no workflow id',
      wildcardSetCategoryId: categoryId,
    }).catch(() => undefined);
    return null;
  }

  // Stamp the workflow id onto BOTH the wildcard category metadata (used by
  // the wildcard cron's "is this in-flight?" check) and the EntityModeration
  // row (used by `recordEntityModerationSuccess`/`Failure` to gate stale
  // callbacks, and by `retry-failed-text-moderation` to dispatch retries).
  await mergeCategoryMetadata(categoryId, { workflowId: workflow.id });
  await dbWrite.entityModeration.updateMany({
    where: {
      entityType: WILDCARD_CATEGORY_ENTITY_TYPE,
      entityId: categoryId,
      status: EntityModerationStatus.Pending,
    },
    data: { workflowId: workflow.id },
  });
  return workflow.id;
}

/**
 * Submit every Pending category in a set whose metadata isn't already
 * tracking an in-flight workflow. Used at import-time (fire-and-forget after
 * `importWildcardModelVersion`) and by the cron's per-set unit of work.
 *
 * Empty categories (zero values) are short-circuited to Clean directly —
 * there's nothing to audit, and we want them counted in the set rollup.
 */
export async function submitWildcardSetAudit(setId: number): Promise<{
  submitted: number;
  skipped: number;
  markedCleanEmpty: number;
}> {
  const categories = await dbRead.wildcardSetCategory.findMany({
    where: { wildcardSetId: setId, auditStatus: WildcardSetCategoryAuditStatus.Pending },
    select: { id: true, valueCount: true, metadata: true },
  });

  let submitted = 0;
  let skipped = 0;
  let markedCleanEmpty = 0;
  let touchedSet = false;
  for (const category of categories) {
    const meta = (category.metadata ?? {}) as WildcardCategoryMetadata;
    if (meta.workflowId) {
      skipped++;
      continue;
    }
    if ((meta.retryCount ?? 0) >= MAX_RETRY) {
      skipped++;
      continue;
    }
    if (category.valueCount === 0) {
      await dbWrite.wildcardSetCategory.update({
        where: { id: category.id },
        data: {
          auditStatus: WildcardSetCategoryAuditStatus.Clean,
          auditedAt: new Date(),
        },
      });
      markedCleanEmpty++;
      touchedSet = true;
      continue;
    }
    const workflowId = await submitWildcardCategoryAudit(category.id);
    if (workflowId) submitted++;
    else skipped++;
  }

  if (touchedSet) {
    await recomputeWildcardSetAuditStatus(setId);
  }

  return { submitted, skipped, markedCleanEmpty };
}

/**
 * Cron unit of work: pick Pending categories that have no in-flight workflow
 * and submit them. Capped per call so the cron isn't unbounded; rerun until
 * `submitted + skipped == 0` to drain.
 */
export async function submitPendingWildcardCategoryAudits(opts?: { limit?: number }): Promise<{
  scanned: number;
  submitted: number;
  skipped: number;
  markedCleanEmpty: number;
}> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 100, 500));

  // We can't cleanly filter on the JSON `metadata.workflowId` predicate via
  // Prisma without raw SQL, so we over-fetch and filter in JS. The status
  // filter prunes the candidate set first.
  const candidates = await dbRead.wildcardSetCategory.findMany({
    where: { auditStatus: WildcardSetCategoryAuditStatus.Pending },
    select: { id: true, valueCount: true, wildcardSetId: true, metadata: true },
    take: limit * 2,
    orderBy: { id: 'asc' },
  });

  const setsToRecompute = new Set<number>();
  let scanned = 0;
  let submitted = 0;
  let skipped = 0;
  let markedCleanEmpty = 0;

  for (const c of candidates) {
    if (scanned >= limit) break;
    scanned++;
    const meta = (c.metadata ?? {}) as WildcardCategoryMetadata;
    if (meta.workflowId) {
      skipped++;
      continue;
    }
    if ((meta.retryCount ?? 0) >= MAX_RETRY) {
      skipped++;
      continue;
    }
    if (c.valueCount === 0) {
      await dbWrite.wildcardSetCategory.update({
        where: { id: c.id },
        data: {
          auditStatus: WildcardSetCategoryAuditStatus.Clean,
          auditedAt: new Date(),
        },
      });
      markedCleanEmpty++;
      setsToRecompute.add(c.wildcardSetId);
      continue;
    }
    const workflowId = await submitWildcardCategoryAudit(c.id);
    if (workflowId) submitted++;
    else skipped++;
  }

  for (const setId of setsToRecompute) {
    await recomputeWildcardSetAuditStatus(setId);
  }

  return { scanned, submitted, skipped, markedCleanEmpty };
}

/**
 * Webhook handler: persist a successful XGuard rollup onto the category and
 * recompute the parent set's aggregate. Two derived values come out of the
 * per-label results:
 *
 *   - `auditStatus`: Dirty iff any of `WILDCARD_AUDIT_FAIL_LABELS` triggered,
 *     OR if `young` + `sexual` co-triggered (synthetic CSAM — XGuard's text
 *     classifiers don't ship a dedicated `csam` label, so we infer it from
 *     the co-trigger). Computed from per-label `triggered` flags — we
 *     deliberately ignore `output.blocked` because it counts triggered level
 *     labels too, which would falsely flip Dirty for ordinary NSFW content.
 *   - `nsfw`: true iff any `WILDCARD_AUDIT_LEVEL_LABELS` triggered. Boolean,
 *     not a bitwise nsfwLevel — XGuard's text classifiers can't reliably
 *     bucket PG / R / X severity for arbitrary text, so a single "is NSFW"
 *     signal is the honest representation of what we can measure.
 *
 * Idempotent: stale callbacks (workflow ID doesn't match the stored
 * in-flight ID) are dropped so a slow-arriving callback can't clobber a
 * newer audit's result.
 */
export async function applyWildcardCategoryAuditSuccess(opts: {
  categoryId: number;
  workflowId: string;
  output: XGuardModerationOutput;
}): Promise<void> {
  const { categoryId, workflowId, output } = opts;

  const current = await dbRead.wildcardSetCategory.findUnique({
    where: { id: categoryId },
    select: { metadata: true, wildcardSetId: true },
  });
  if (!current) {
    logToAxiom({
      type: 'warning',
      name: 'wildcard-category-audit',
      message: 'callback for missing category',
      wildcardSetCategoryId: categoryId,
      workflowId,
    }).catch(() => undefined);
    return;
  }
  const meta = (current.metadata ?? {}) as WildcardCategoryMetadata;
  if (meta.workflowId && meta.workflowId !== workflowId) {
    logToAxiom({
      type: 'warning',
      name: 'wildcard-category-audit',
      message: 'stale workflow callback ignored',
      wildcardSetCategoryId: categoryId,
      workflowId,
      activeWorkflowId: meta.workflowId,
    }).catch(() => undefined);
    return;
  }

  // Partition the per-label results: fail labels drive Dirty; level labels
  // drive the `nsfw` boolean. Falling back to score-vs-threshold for the
  // trigger check makes the code resilient to results that ship without
  // the explicit `triggered` flag set.
  const results = output.results ?? [];
  const isTriggered = (r: (typeof results)[number]) =>
    r.triggered || (typeof r.score === 'number' && r.score >= r.threshold);

  // Cache the fail-result subset since we use it twice — once to derive the
  // triggered labels (for the audit note) and again to extract matched terms
  // (for the forensic metadata on Dirty rows).
  const triggeredFailResults = results.filter((r) => FAIL_LABEL_SET.has(r.label) && isTriggered(r));
  const triggeredFailLabels = triggeredFailResults.map((r) => r.label);

  // Synthetic CSAM: XGuard's text classifiers don't ship a dedicated `csam`
  // label, but `young` + `sexual` co-triggered is the policy equivalent.
  // Treat that combination as a hard fail (Dirty), same as an explicit CSAM
  // match. Either label alone just contributes to the `nsfw` flag below.
  const youngResult = results.find((r) => r.label === 'young' && isTriggered(r));
  const sexualResult = results.find((r) => r.label === 'sexual' && isTriggered(r));
  const syntheticCsamResults =
    youngResult && sexualResult ? [youngResult, sexualResult] : [];
  const syntheticCsam = syntheticCsamResults.length > 0;

  const blocked = triggeredFailResults.length > 0 || syntheticCsam;

  // Boolean OR across triggered level labels. False when nothing triggered —
  // purely textual content with no NSFW signal is treated as SFW. Distinct
  // from auditStatus = Pending (which means "not yet audited").
  const nsfw = results.some((r) => LEVEL_LABEL_SET.has(r.label) && isTriggered(r));

  // Labels surfaced to moderators on Dirty rows. Synthetic CSAM gets its own
  // pseudo-label so the audit note reads "Blocked: csam (young+sexual)"
  // instead of looking empty when no real fail label fired on its own.
  const blockingLabels = syntheticCsam
    ? [...triggeredFailLabels, 'csam (young+sexual)']
    : triggeredFailLabels;

  // Terms that any blocking result matched — fail labels plus the
  // young+sexual co-trigger. Only kept for Dirty categories so a moderator
  // can see what triggered. Level-label matches that didn't co-fire as CSAM
  // aren't surfaced; their signal is already captured in `nsfw`.
  const blockingResults = [...triggeredFailResults, ...syntheticCsamResults];
  const triggeredTerms = blocked
    ? Array.from(
        new Set(
          blockingResults
            .flatMap((r) => r.matchedTerms?.text ?? [])
            .filter((t): t is string => typeof t === 'string' && t.length > 0)
        )
      )
    : [];

  const auditStatus = blocked
    ? WildcardSetCategoryAuditStatus.Dirty
    : WildcardSetCategoryAuditStatus.Clean;
  const auditNote = blocked
    ? `Blocked: ${blockingLabels.join(', ') || 'unspecified labels'}; ${
        triggeredTerms.length
      } term(s) triggered`
    : null;

  // Persist forensics only when Dirty — Clean categories drop them so we
  // don't keep stale matched terms from prior audits. `triggeredLabels`
  // records the blocking labels (real fail labels + the synthetic
  // `csam (young+sexual)` entry) since the level classification is already
  // captured in `nsfw`.
  const nextMetadata: WildcardCategoryMetadata = {
    ...meta,
    workflowId: undefined,
    retryCount: undefined,
    triggeredTerms: blocked ? triggeredTerms : undefined,
    triggeredLabels: blocked ? blockingLabels : undefined,
  };

  await dbWrite.wildcardSetCategory.update({
    where: { id: categoryId },
    data: {
      auditStatus,
      auditedAt: new Date(),
      auditNote,
      nsfw,
      metadata: serializeMetadata(nextMetadata),
    },
  });

  // Mirror the success onto the EntityModeration row so the retry job sees
  // a Succeeded row and stops trying. Stale callbacks (workflowId mismatch)
  // are filtered inside `recordEntityModerationSuccess` itself — we don't
  // need to gate again here.
  await recordEntityModerationSuccess({
    entityType: WILDCARD_CATEGORY_ENTITY_TYPE,
    entityId: categoryId,
    workflowId,
    output: opts.output,
  });

  await recomputeWildcardSetAuditStatus(current.wildcardSetId);
}

/**
 * Webhook handler: terminal-failure callback. Bumps `retryCount` on the
 * category metadata so the cron can stop retrying after `MAX_RETRY`
 * consecutive failures. Status stays `Pending`.
 *
 * Also mirrors the failure onto the EntityModeration row so the
 * `retry-failed-text-moderation` job can pick it up for resubmission — the
 * wildcard-side cron only handles Pending categories with cleared workflowIds
 * (i.e. ones we already gave up on after orchestrator failure), while the
 * EntityModeration retry handles Failed/Expired/Canceled rows specifically.
 */
export async function applyWildcardCategoryAuditFailure(opts: {
  categoryId: number;
  workflowId: string;
  status: 'failed' | 'expired' | 'canceled';
}): Promise<void> {
  const { categoryId, workflowId, status } = opts;

  const current = await dbRead.wildcardSetCategory.findUnique({
    where: { id: categoryId },
    select: { metadata: true },
  });
  if (!current) return;

  const meta = (current.metadata ?? {}) as WildcardCategoryMetadata;
  if (meta.workflowId && meta.workflowId !== workflowId) return; // stale

  const nextMetadata: WildcardCategoryMetadata = {
    ...meta,
    workflowId: undefined,
    retryCount: (meta.retryCount ?? 0) + 1,
  };

  await dbWrite.wildcardSetCategory.update({
    where: { id: categoryId },
    data: { metadata: serializeMetadata(nextMetadata) },
  });

  // Mirror onto the EntityModeration row. The status maps directly to
  // `EntityModerationStatus`'s capitalized values via the same helper Article
  // uses, so the retry job's predicates (Failed/Expired/Canceled + updatedAt
  // > 1hr) trigger correctly.
  const entityStatus = {
    failed: EntityModerationStatus.Failed,
    expired: EntityModerationStatus.Expired,
    canceled: EntityModerationStatus.Canceled,
  }[status];
  await recordEntityModerationFailure({
    entityType: WILDCARD_CATEGORY_ENTITY_TYPE,
    entityId: categoryId,
    workflowId,
    status: entityStatus,
  });
}

/**
 * Recompute a wildcard set's aggregate audit status and `nsfw` rollup from
 * its categories. Called after every category-level transition that could
 * shift the set's bucket (Pending → Clean/Dirty/Mixed) or any category's
 * `nsfw` flag.
 *
 * Aggregation rules (auditStatus):
 *   - any category Pending → set Pending
 *   - all Clean → set Clean
 *   - any Dirty AND any Clean → set Mixed
 *   - all Dirty → set Dirty
 *
 * Aggregation rule (nsfw): boolean OR of every non-Dirty category's `nsfw`
 * flag. Lets visibility checks (".com hides any set with NSFW content") run
 * as a single-column predicate, avoiding a category sub-query on every check.
 *
 * Set-level reads (`getWildcardSets`) hide `Dirty` sets entirely; `Mixed`
 * sets are visible with their Dirty categories filtered at the picker layer.
 */
export async function recomputeWildcardSetAuditStatus(setId: number): Promise<void> {
  const categories = await dbRead.wildcardSetCategory.findMany({
    where: { wildcardSetId: setId },
    select: { auditStatus: true, nsfw: true },
  });

  const nextStatus = aggregateSetStatus(categories.map((c) => c.auditStatus));
  // Boolean OR across non-Dirty categories. Dirty rows are excluded from the
  // rollup because their content isn't usable at any site context — a Dirty
  // category contributing `nsfw = true` would falsely advertise "this set
  // has NSFW content" when it really doesn't have any usable NSFW content.
  const nextNsfw = categories.some(
    (c) => c.auditStatus !== WildcardSetCategoryAuditStatus.Dirty && c.nsfw
  );

  await dbWrite.wildcardSet.update({
    where: { id: setId },
    data: {
      auditStatus: nextStatus,
      nsfw: nextNsfw,
      auditedAt: nextStatus === WildcardSetAuditStatus.Pending ? null : new Date(),
    },
  });
}

function aggregateSetStatus(
  categoryStatuses: WildcardSetCategoryAuditStatus[]
): WildcardSetAuditStatus {
  if (categoryStatuses.length === 0) return WildcardSetAuditStatus.Pending;
  if (categoryStatuses.includes(WildcardSetCategoryAuditStatus.Pending)) {
    return WildcardSetAuditStatus.Pending;
  }
  const hasDirty = categoryStatuses.includes(WildcardSetCategoryAuditStatus.Dirty);
  const hasClean = categoryStatuses.includes(WildcardSetCategoryAuditStatus.Clean);
  if (hasDirty && hasClean) return WildcardSetAuditStatus.Mixed;
  if (hasDirty) return WildcardSetAuditStatus.Dirty;
  return WildcardSetAuditStatus.Clean;
}

async function mergeCategoryMetadata(
  categoryId: number,
  patch: Partial<WildcardCategoryMetadata>
): Promise<void> {
  const current = await dbRead.wildcardSetCategory.findUnique({
    where: { id: categoryId },
    select: { metadata: true },
  });
  const meta = (current?.metadata ?? {}) as WildcardCategoryMetadata;
  const next = { ...meta, ...patch };
  await dbWrite.wildcardSetCategory.update({
    where: { id: categoryId },
    data: { metadata: serializeMetadata(next) },
  });
}

// Strip empty/zero/undefined fields so the serialized JSON stays compact and
// reflects only meaningful state (rather than persisting `{ retryCount: 0 }`
// or `{ triggeredTerms: [] }`).
function serializeMetadata(meta: WildcardCategoryMetadata): Prisma.InputJsonValue {
  const out: WildcardCategoryMetadata = {};
  if (meta.workflowId) out.workflowId = meta.workflowId;
  if (meta.triggeredTerms?.length) out.triggeredTerms = meta.triggeredTerms;
  if (meta.triggeredLabels?.length) out.triggeredLabels = meta.triggeredLabels;
  if (meta.retryCount && meta.retryCount > 0) out.retryCount = meta.retryCount;
  return out as Prisma.InputJsonValue;
}
