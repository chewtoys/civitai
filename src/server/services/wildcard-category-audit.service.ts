import type { XGuardModerationOutput, XGuardModerationStepTemplate } from '@civitai/client';
import { submitWorkflow } from '@civitai/client';
import { Prisma } from '@prisma/client';
import { env } from '~/env/server';
import { dbRead, dbWrite } from '~/server/db/client';
import { logToAxiom } from '~/server/logging/client';
import { internalOrchestratorClient } from '~/server/services/orchestrator/client';
import {
  WildcardSetAuditStatus,
  WildcardSetCategoryAuditStatus,
} from '~/shared/utils/prisma/enums';

// XGuard labels evaluated for wildcard category audits. Add to this list as
// policy expands — the constant flows through to the xGuardModeration step's
// `labels` input which constrains which evaluators run.
const WILDCARD_AUDIT_LABELS = [
  'csam',
  'urine',
  'diaper',
  'scat',
  'menstruation',
  'bestiality',
] as const;

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
 * Submit one wildcard category for XGuard audit. The category's `values` are
 * joined with newlines into a single text-mode xGuardModeration step; the
 * workflow ID is stamped onto `category.metadata.workflowId` so the cron can
 * tell what's in flight.
 *
 * Returns the workflow ID on a successful submission. Returns `null` when:
 *   - the category no longer exists
 *   - the category has no values (caller should mark Clean directly)
 *   - the orchestrator submission silently failed (caller may retry on the
 *     next cron tick)
 */
export async function submitWildcardCategoryAudit(categoryId: number): Promise<string | null> {
  const category = await dbRead.wildcardSetCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, values: true },
  });
  if (!category) return null;
  if (!category.values || category.values.length === 0) return null;

  const text = category.values.join('\n');
  const callbackUrl = buildCallbackUrl();
  const metadata = { wildcardSetCategoryId: categoryId };

  const { data, error, response } = await submitWorkflow({
    client: internalOrchestratorClient,
    body: {
      metadata,
      currencies: [],
      steps: [
        {
          $type: 'xGuardModeration',
          name: 'textModeration',
          metadata,
          priority: 'low',
          input: {
            text,
            mode: 'text',
            labels: [...WILDCARD_AUDIT_LABELS],
            storeFullResponse: false,
          },
        } as XGuardModerationStepTemplate,
      ],
      callbacks: [
        {
          url: callbackUrl,
          type: ['workflow:succeeded', 'workflow:failed', 'workflow:expired', 'workflow:canceled'],
        },
      ],
    },
  });

  if (!data?.id) {
    logToAxiom({
      type: 'error',
      name: 'wildcard-category-audit',
      message: 'orchestrator submitWorkflow returned no workflow id',
      wildcardSetCategoryId: categoryId,
      responseStatus: response?.status,
      error,
    }).catch(() => undefined);
    return null;
  }

  await mergeCategoryMetadata(categoryId, { workflowId: data.id });
  return data.id;
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
 * recompute the parent set's aggregate. Strict aggregation — `blocked` flips
 * the category to `Dirty` regardless of which/how many values triggered.
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

  const blocked = !!output.blocked;
  const triggeredLabels = output.triggeredLabels ?? [];
  const triggeredTerms = blocked
    ? Array.from(
        new Set(
          (output.results ?? [])
            .filter((r) => r.score >= r.threshold)
            .flatMap((r) => r.matchedTerms?.text ?? [])
            .filter((t): t is string => typeof t === 'string' && t.length > 0)
        )
      )
    : [];

  const auditStatus = blocked
    ? WildcardSetCategoryAuditStatus.Dirty
    : WildcardSetCategoryAuditStatus.Clean;
  const auditNote = blocked
    ? `Blocked: ${triggeredLabels.join(', ') || 'unspecified labels'}; ${
        triggeredTerms.length
      } term(s) triggered`
    : null;

  // Persist forensics only when Dirty — Clean categories drop them so we
  // don't keep stale matched terms from prior audits.
  const nextMetadata: WildcardCategoryMetadata = {
    ...meta,
    workflowId: undefined,
    retryCount: undefined,
    triggeredTerms: blocked ? triggeredTerms : undefined,
    triggeredLabels: blocked ? triggeredLabels : undefined,
  };

  await dbWrite.wildcardSetCategory.update({
    where: { id: categoryId },
    data: {
      auditStatus,
      auditedAt: new Date(),
      auditNote,
      metadata: serializeMetadata(nextMetadata),
    },
  });

  await recomputeWildcardSetAuditStatus(current.wildcardSetId);
}

/**
 * Webhook handler: terminal-failure callback. Bumps `retryCount` on the
 * category metadata so the cron can stop retrying after `MAX_RETRY`
 * consecutive failures. Status stays `Pending`.
 */
export async function applyWildcardCategoryAuditFailure(opts: {
  categoryId: number;
  workflowId: string;
  status: 'failed' | 'expired' | 'canceled';
}): Promise<void> {
  const { categoryId, workflowId } = opts;

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
}

/**
 * Recompute a wildcard set's aggregate audit status from its categories'
 * statuses. Called after every category-level transition that could shift the
 * set's bucket (Pending → Clean/Dirty/Mixed).
 *
 * Aggregation rules:
 *   - any category Pending → set Pending
 *   - all Clean → set Clean
 *   - any Dirty AND any Clean → set Mixed
 *   - all Dirty → set Dirty
 *
 * Set-level reads (`getWildcardSets`) hide `Dirty` sets entirely; `Mixed`
 * sets are visible with their Dirty categories filtered at the picker layer.
 */
export async function recomputeWildcardSetAuditStatus(setId: number): Promise<void> {
  const categories = await dbRead.wildcardSetCategory.findMany({
    where: { wildcardSetId: setId },
    select: { auditStatus: true },
  });

  const next = aggregateSetStatus(categories.map((c) => c.auditStatus));
  await dbWrite.wildcardSet.update({
    where: { id: setId },
    data: {
      auditStatus: next,
      auditedAt: next === WildcardSetAuditStatus.Pending ? null : new Date(),
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
