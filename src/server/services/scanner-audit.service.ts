/**
 * Scanner audit log writer (ClickHouse `scanner_label_results`).
 *
 * Called from scanner webhooks (currently only XGuard text/prompt; image
 * ingestion comes later) to record one row per per-label scan result for the
 * prompt-tuning workflow. The raw orchestrator response stays in the
 * orchestrator (30-day TTL); this table is the queryable index over scores,
 * thresholds, and matched terms used by the moderator review UI and ad-hoc
 * tuning analysis.
 *
 * Writes are fire-and-forget: any ClickHouse failure is logged to Axiom but
 * never propagates back to the operational webhook path.
 */
import type { Workflow, XGuardLabelResult, XGuardModerationStep } from '@civitai/client';
import { clickhouse } from '~/server/clickhouse/client';
import { logToAxiom } from '~/server/logging/client';

/**
 * Age-classifier topK band names that count as minor. Includes Teenager 13-20
 * intentionally — the band spans both minor and adult ages, but for FN-browse
 * purposes we want the score to reflect "how close to a minor classification"
 * the model put this image, not just whether isMinor flipped.
 */
const MINOR_AGE_BANDS = new Set(['Child 0-12', 'Teenager 13-20']);

type MediaRatingOutput = {
  nsfwLevel: string;
  isBlocked: boolean;
  blockedReason?: string;
  ageClassification?: {
    detections: Array<{
      isMinor: boolean;
      confidence: number;
      topK?: Record<string, number>;
    }>;
  };
  faceRecognition?: { faces: Array<unknown> };
  aiRecognition?: { label: string; confidence: number };
  animeRecognition?: { label: string; confidence: number };
};

/**
 * Translate the `mediaRating` step output into per-label rows for
 * `scanner_label_results`. Always emits `nsfw_level` and `is_blocked`; emits
 * `minor`/`ai`/`anime` only when the corresponding classifier was included in
 * the step (transition-period workflows may have just `nsfwLevel` + `isBlocked`).
 *
 * Policy + model version are hardcoded to '1' — image-side policies aren't
 * civitai-managed yet, so we just stamp a placeholder so the column is
 * meaningful and bumpable later without a backfill.
 */
export async function recordImageScan({
  workflowId,
  imageId,
  mediaRating,
  startedAt,
  completedAt,
}: {
  workflowId: string;
  imageId: number;
  mediaRating: MediaRatingOutput;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
}) {
  if (!clickhouse) return;

  type LabelCell = {
    label: string;
    labelValue: string;
    score: number;
    threshold: number | null;
    triggered: 0 | 1;
  };

  const labels: LabelCell[] = [
    {
      label: 'nsfw_level',
      labelValue: mediaRating.nsfwLevel,
      score: 1,
      threshold: null,
      triggered: 1,
    },
    {
      label: 'is_blocked',
      labelValue: '',
      score: mediaRating.isBlocked ? 1 : 0,
      threshold: null,
      triggered: mediaRating.isBlocked ? 1 : 0,
    },
  ];

  if (mediaRating.ageClassification) {
    const detections = mediaRating.ageClassification.detections ?? [];
    const minorScore = detections.reduce((max, d) => {
      const topK = d.topK ?? {};
      const probSum = Object.entries(topK).reduce(
        (sum, [band, p]) => (MINOR_AGE_BANDS.has(band) ? sum + p : sum),
        0
      );
      return Math.max(max, probSum);
    }, 0);
    labels.push({
      label: 'minor',
      labelValue: '',
      score: minorScore,
      threshold: null,
      triggered: detections.some((d) => d.isMinor) ? 1 : 0,
    });
  }

  if (mediaRating.aiRecognition) {
    labels.push({
      label: 'ai',
      labelValue: mediaRating.aiRecognition.label,
      score: mediaRating.aiRecognition.confidence,
      threshold: null,
      triggered: mediaRating.aiRecognition.label === 'AI' ? 1 : 0,
    });
  }

  if (mediaRating.animeRecognition) {
    labels.push({
      label: 'anime',
      labelValue: mediaRating.animeRecognition.label,
      score: mediaRating.animeRecognition.confidence,
      threshold: null,
      triggered: mediaRating.animeRecognition.label === 'anime' ? 1 : 0,
    });
  }

  const startedAtStr = toClickhouseDateTime(startedAt);
  const completedAtStr = toClickhouseDateTime(completedAt);
  const durationMs =
    startedAtStr && completedAtStr
      ? Math.max(0, new Date(completedAtStr).getTime() - new Date(startedAtStr).getTime())
      : 0;
  const startedAtCell = startedAtStr ?? '1970-01-01 00:00:00';
  const completedAtCell = completedAtStr ?? '1970-01-01 00:00:00';

  const rows = labels.map((l) => ({
    workflowId,
    scanner: 'image_ingestion',
    entityType: 'image',
    entityId: String(imageId),
    label: l.label,
    labelValue: l.labelValue,
    score: l.score,
    threshold: l.threshold,
    triggered: l.triggered,
    policyVersion: '1',
    modelVersion: '1',
    modelReason: '',
    matchedText: [],
    matchedPositivePrompt: [],
    matchedNegativePrompt: [],
    startedAt: startedAtCell,
    completedAt: completedAtCell,
    durationMs,
  }));

  try {
    await clickhouse.insert({
      table: 'scanner_label_results',
      values: rows,
      format: 'JSONEachRow',
    });
  } catch (e) {
    const error = e as Error;
    await logToAxiom({
      name: 'scanner-audit-write-failed',
      type: 'error',
      message: error.message,
      workflowId,
      scanner: 'image_ingestion',
      entityType: 'image',
      entityId: String(imageId),
      labelRowCount: rows.length,
    });
  }
}

function toClickhouseDateTime(input: Date | string | null | undefined): string | null {
  if (!input) return null;
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return null;
  // ClickHouse DateTime format: 'YYYY-MM-DD HH:MM:SS' (UTC, no T/Z).
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export async function recordXGuardScan({
  workflowId,
  mode,
  entityType,
  entityId,
  results,
  modelVersion,
  startedAt,
  completedAt,
}: {
  workflowId: string;
  mode: 'text' | 'prompt';
  entityType?: string;
  entityId?: string | number;
  results: XGuardLabelResult[];
  modelVersion: string;
  /** Workflow timing from the orchestrator response. Replicated on every label
   * row to keep the schema single-table — for `DISTINCT`/`GROUP BY workflowId`
   * aggregations of durations, use `any(durationMs)`. */
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
}) {
  if (!clickhouse) return;
  if (!results.length) return;

  const scanner = mode === 'text' ? 'xguard_text' : 'xguard_prompt';
  const entityTypeStr = entityType ?? '';
  const entityIdStr = entityId !== undefined ? String(entityId) : '';

  const startedAtStr = toClickhouseDateTime(startedAt);
  const completedAtStr = toClickhouseDateTime(completedAt);
  const durationMs =
    startedAtStr && completedAtStr
      ? Math.max(0, new Date(completedAtStr).getTime() - new Date(startedAtStr).getTime())
      : 0;
  // ClickHouse rejects a JSONEachRow value of null for a non-Nullable column;
  // fall back to the epoch sentinel (matches the column's DEFAULT toDateTime(0))
  // when the workflow didn't surface a timestamp.
  const startedAtCell = startedAtStr ?? '1970-01-01 00:00:00';
  const completedAtCell = completedAtStr ?? '1970-01-01 00:00:00';

  const labelRows = results.map((r) => {
    const triggered = r.triggered ? 1 : 0;
    return {
      workflowId,
      scanner,
      entityType: entityTypeStr,
      entityId: entityIdStr,
      label: r.label,
      // XGuard labels are binary (triggered/not); labelValue is reserved for
      // multi-class signals like the image-ingestion `nsfw_level` rating.
      labelValue: '',
      score: r.score,
      threshold: r.threshold,
      triggered,
      policyVersion: r.policyHash ?? '',
      modelVersion,
      // Only persist the explanation fields when the label actually fired —
      // they're a wall of text per row otherwise, and untriggered rows have
      // nothing useful to say.
      modelReason: triggered ? r.modelReason ?? '' : '',
      matchedText: triggered ? r.matchedTerms?.text ?? [] : [],
      matchedPositivePrompt: triggered ? r.matchedTerms?.positivePrompt ?? [] : [],
      matchedNegativePrompt: triggered ? r.matchedTerms?.negativePrompt ?? [] : [],
      startedAt: startedAtCell,
      completedAt: completedAtCell,
      durationMs,
    };
  });

  try {
    await clickhouse.insert({
      table: 'scanner_label_results',
      values: labelRows,
      format: 'JSONEachRow',
    });
  } catch (e) {
    const error = e as Error;
    await logToAxiom({
      name: 'scanner-audit-write-failed',
      type: 'error',
      message: error.message,
      workflowId,
      scanner,
      entityType: entityTypeStr,
      entityId: entityIdStr,
      labelRowCount: labelRows.length,
    });
  }
}

/**
 * Pull the per-label results off a succeeded XGuard workflow and write them
 * to the audit log. No-op if `metadata.recordForReview` isn't set, or if no
 * xGuardModeration step output is present. Used by both the text-moderation
 * webhook (`text-moderation-result.ts`) and the synchronous-wait test
 * endpoint (`/api/admin/test`).
 */
export async function recordXGuardScanFromWorkflow(workflow: Workflow) {
  if (workflow.metadata?.recordForReview !== true) return;

  const steps = (workflow.steps ?? []) as unknown as XGuardModerationStep[];
  const step = steps.find((s) => s.$type === 'xGuardModeration');
  if (!step?.output || !workflow.id) return;

  await recordXGuardScan({
    workflowId: workflow.id,
    mode: (workflow.metadata.mode as 'text' | 'prompt' | undefined) ?? 'text',
    entityType: workflow.metadata.entityType as string | undefined,
    entityId: workflow.metadata.entityId as number | undefined,
    results: step.output.results,
    modelVersion: (workflow.metadata.modelVersion as string | undefined) ?? '1',
    startedAt: workflow.startedAt,
    completedAt: workflow.completedAt,
  });
}
