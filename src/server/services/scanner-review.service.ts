/**
 * Reads from ClickHouse `scanner_label_results` (AggregatingMergeTree) and
 * Postgres `ScannerLabelReview` (moderator verdicts) for the
 * `/moderator/scanner-audit` UI.
 *
 * The dedup unit is `(contentHash, version, label)` — duplicate scans of
 * the same content under the same policy collapse into one row at merge
 * time, with `occurrences` summed and `workflowIds` accumulated. All queue
 * queries do GROUP BY on those three columns and filter by `lastSeenAt` to
 * stay within recent partitions.
 */
import { TRPCError } from '@trpc/server';
import { clickhouse } from '~/server/clickhouse/client';
import { dbRead, dbWrite } from '~/server/db/client';
import type { ReviewVerdict } from '~/shared/utils/prisma/enums';
import type { QueueView, Scanner } from '~/server/schema/scanner-review.schema';

/** How far back the queue + detail queries look. Caps partition reads so a
 * mod opening the page doesn't scan years of history. The Aggregating engine
 * only merges within a partition, so this also defines the dedup window. */
const DEFAULT_LOOKBACK_DAYS = 30;

export type AggregatedScanRow = {
  contentHash: string;
  version: string;
  label: string;
  scanner: string;
  entityType: string;
  labelValue: string;
  modelVersion: string;
  score: number;
  threshold: number | null;
  triggered: 0 | 1;
  modelReason: string;
  matchedText: string[];
  matchedPositivePrompt: string[];
  matchedNegativePrompt: string[];
  durationMs: number;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  workflowIds: string[];
  entityIds: string[];
};

export type QueueRow = AggregatedScanRow & {
  myVerdict: ReviewVerdict | null;
  anyVerdict: ReviewVerdict | null;
};

const AGGREGATE_SELECT = `
  contentHash,
  version,
  label,
  any(scanner) AS scanner,
  any(entityType) AS entityType,
  any(labelValue) AS labelValue,
  any(modelVersion) AS modelVersion,
  anyLast(score) AS score,
  anyLast(threshold) AS threshold,
  max(triggered) AS triggered,
  anyLast(modelReason) AS modelReason,
  anyLast(matchedText) AS matchedText,
  anyLast(matchedPositivePrompt) AS matchedPositivePrompt,
  anyLast(matchedNegativePrompt) AS matchedNegativePrompt,
  anyLast(durationMs) AS durationMs,
  min(firstSeenAt) AS firstSeenAt,
  max(lastSeenAt) AS lastSeenAt,
  sum(occurrences) AS occurrences,
  groupUniqArrayArray(workflowIds) AS workflowIds,
  groupUniqArrayArray(entityIds) AS entityIds
`;

function ensureClickhouse() {
  if (!clickhouse) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'ClickHouse client not configured',
    });
  }
  return clickhouse;
}

type ListInput = {
  scanner?: Scanner;
  view: QueueView;
  label?: string;
  version?: string;
  nearMissFloor: number;
  lookbackDays?: number;
  limit: number;
  offset: number;
};

export async function listScans(
  input: ListInput,
  userId: number
): Promise<{ rows: QueueRow[]; total: number }> {
  const ch = ensureClickhouse();
  const lookback = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;

  const conditions: string[] = [`lastSeenAt > now() - INTERVAL ${lookback} DAY`];
  const params: Record<string, unknown> = {
    limit: input.limit,
    offset: input.offset,
  };

  if (input.scanner) {
    conditions.push('scanner = {scanner:String}');
    params.scanner = input.scanner;
  }
  if (input.label) {
    conditions.push('label = {label:String}');
    params.label = input.label;
  }
  if (input.version) {
    conditions.push('version = {version:String}');
    params.version = input.version;
  }

  // HAVING references aggregate functions directly (not the SELECT aliases) so
  // it works regardless of `prefer_column_name_to_alias`. With that setting
  // ON, `HAVING triggered = 1` would resolve to the raw column rather than
  // `max(triggered)` and silently match nothing.
  const havingClause =
    input.view === 'triggered'
      ? 'max(triggered) = 1'
      : `max(triggered) = 0 AND anyLast(threshold) IS NOT NULL AND anyLast(score) >= anyLast(threshold) * {nearMissFloor:Float32}`;

  if (input.view === 'near-miss') {
    params.nearMissFloor = input.nearMissFloor;
  }

  // Same applies to ORDER BY — reference the aggregate explicitly.
  const orderBy = input.view === 'triggered' ? 'max(lastSeenAt) DESC' : 'anyLast(score) DESC';

  const where = `WHERE ${conditions.join(' AND ')}`;

  // SETTINGS prefer_column_name_to_alias = 1 prevents ClickHouse from resolving
  // `lastSeenAt` etc. in WHERE/ORDER BY to the SELECT-clause aggregate alias
  // (which would be illegal in WHERE). With this setting, raw column wins —
  // standard-SQL semantics, and the partition prune on lastSeenAt keeps working.
  const dataQuery = `
    SELECT ${AGGREGATE_SELECT}
    FROM scanner_label_results
    ${where}
    GROUP BY contentHash, version, label
    HAVING ${havingClause}
    ORDER BY ${orderBy}
    LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    SETTINGS prefer_column_name_to_alias = 1
  `;

  const countQuery = `
    SELECT count() AS total FROM (
      SELECT contentHash, version, label,
             max(triggered) AS triggered,
             anyLast(score) AS score,
             anyLast(threshold) AS threshold
      FROM scanner_label_results
      ${where}
      GROUP BY contentHash, version, label
      HAVING ${havingClause}
    )
    SETTINGS prefer_column_name_to_alias = 1
  `;

  const [dataResp, countResp] = await Promise.all([
    ch.query({ query: dataQuery, query_params: params, format: 'JSONEachRow' }),
    ch.query({ query: countQuery, query_params: params, format: 'JSONEachRow' }),
  ]);

  const rows = (await dataResp.json()) as AggregatedScanRow[];
  const [countRow] = (await countResp.json()) as Array<{ total: string }>;
  const total = Number(countRow?.total ?? 0);

  if (rows.length === 0) return { rows: [], total };

  // Enrich with Postgres review state.
  const keys = rows.map((r) => ({
    contentHash: r.contentHash,
    version: r.version,
    label: r.label,
  }));
  const verdicts = await dbRead.scannerLabelReview.findMany({
    where: { OR: keys },
    select: {
      contentHash: true,
      version: true,
      label: true,
      reviewedBy: true,
      verdict: true,
    },
  });

  const myMap = new Map<string, ReviewVerdict>();
  const anyMap = new Map<string, ReviewVerdict>();
  for (const v of verdicts) {
    const key = `${v.contentHash}::${v.version}::${v.label}`;
    if (v.reviewedBy === userId) myMap.set(key, v.verdict);
    if (!anyMap.has(key)) anyMap.set(key, v.verdict);
  }

  return {
    rows: rows.map((r) => {
      const key = `${r.contentHash}::${r.version}::${r.label}`;
      return {
        ...r,
        myVerdict: myMap.get(key) ?? null,
        anyVerdict: anyMap.get(key) ?? null,
      };
    }),
    total,
  };
}

/**
 * For the detail drawer: every label evaluated for this (contentHash,
 * version) — mod can see the full per-label breakdown for one content
 * under one policy version, plus existing verdicts from any mod.
 */
export async function getScanDetail(input: {
  contentHash: string;
  version: string;
  lookbackDays?: number;
}) {
  const ch = ensureClickhouse();
  const lookback = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;

  const resp = await ch.query({
    query: `
      SELECT ${AGGREGATE_SELECT}
      FROM scanner_label_results
      WHERE contentHash = {contentHash:String}
        AND version = {version:String}
        AND lastSeenAt > now() - INTERVAL ${lookback} DAY
      GROUP BY contentHash, version, label
      ORDER BY triggered DESC, score DESC
      SETTINGS prefer_column_name_to_alias = 1
    `,
    query_params: { contentHash: input.contentHash, version: input.version },
    format: 'JSONEachRow',
  });
  const rows = (await resp.json()) as AggregatedScanRow[];

  const verdicts = await dbRead.scannerLabelReview.findMany({
    where: { contentHash: input.contentHash, version: input.version },
    select: {
      label: true,
      reviewedBy: true,
      reviewedAt: true,
      verdict: true,
      note: true,
    },
  });

  return { rows, verdicts };
}

export async function upsertLabelVerdict(input: {
  contentHash: string;
  version: string;
  label: string;
  verdict: ReviewVerdict;
  note?: string;
  userId: number;
}) {
  return dbWrite.scannerLabelReview.upsert({
    where: {
      contentHash_version_label_reviewedBy: {
        contentHash: input.contentHash,
        version: input.version,
        label: input.label,
        reviewedBy: input.userId,
      },
    },
    create: {
      contentHash: input.contentHash,
      version: input.version,
      label: input.label,
      reviewedBy: input.userId,
      verdict: input.verdict,
      note: input.note,
    },
    update: {
      verdict: input.verdict,
      note: input.note,
      reviewedAt: new Date(),
    },
  });
}

export async function deleteLabelVerdict(input: {
  contentHash: string;
  version: string;
  label: string;
  userId: number;
}) {
  await dbWrite.scannerLabelReview.deleteMany({
    where: {
      contentHash: input.contentHash,
      version: input.version,
      label: input.label,
      reviewedBy: input.userId,
    },
  });
}
