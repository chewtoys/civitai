/**
 * Reads from ClickHouse `scanner_label_results` (queue) and Postgres
 * `ScannerScanReview` / `ScannerReview` (moderator verdicts) for the
 * `/moderator/scanner-audit` UI.
 *
 * Queue queries are denormalized to one row per (workflowId, label) — a
 * triggered scan with multiple firing labels shows as multiple queue rows.
 * The detail-panel query, by contrast, fetches every label result for one
 * workflowId so the mod can verdict all of them in one place.
 */
import { TRPCError } from '@trpc/server';
import { clickhouse } from '~/server/clickhouse/client';
import { dbRead, dbWrite } from '~/server/db/client';
import type { ReviewVerdict } from '~/shared/utils/prisma/enums';
import type { QueueView, Scanner } from '~/server/schema/scanner-review.schema';

export type ScanLabelRow = {
  workflowId: string;
  scanner: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  label: string;
  labelValue: string;
  score: number;
  threshold: number | null;
  triggered: 0 | 1;
  policyVersion: string;
  modelVersion: string;
  modelReason: string;
  matchedText: string[];
  matchedPositivePrompt: string[];
  matchedNegativePrompt: string[];
};

export type QueueRow = ScanLabelRow & {
  hasScanReview: boolean;
  labelVerdict: ReviewVerdict | null;
};

function ensureClickhouse() {
  if (!clickhouse) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'ClickHouse client not configured',
    });
  }
  return clickhouse;
}

export async function listScans(input: {
  scanner?: Scanner;
  view: QueueView;
  label?: string;
  policyVersion?: string;
  nearMissFloor: number;
  limit: number;
  offset: number;
}): Promise<{ rows: QueueRow[]; total: number }> {
  const ch = ensureClickhouse();
  const conditions: string[] = [];
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
  if (input.policyVersion) {
    conditions.push('policyVersion = {policyVersion:String}');
    params.policyVersion = input.policyVersion;
  }

  // Triggered: rows that fired. Near-miss: rows that didn't fire but came
  // close (score above threshold * floor). Triggered with no threshold (we
  // ever stored one) is rare; default-allow.
  if (input.view === 'triggered') {
    conditions.push('triggered = 1');
  } else {
    conditions.push('triggered = 0');
    conditions.push('threshold IS NOT NULL');
    conditions.push('score >= threshold * {nearMissFloor:Float32}');
    params.nearMissFloor = input.nearMissFloor;
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const orderBy = input.view === 'triggered' ? 'createdAt DESC' : 'score DESC';

  const dataQuery = `
    SELECT
      workflowId, scanner, entityType, entityId, createdAt,
      label, labelValue, score, threshold, triggered,
      policyVersion, modelVersion, modelReason,
      matchedText, matchedPositivePrompt, matchedNegativePrompt
    FROM scanner_label_results
    ${where}
    ORDER BY ${orderBy}
    LIMIT {limit:UInt32} OFFSET {offset:UInt32}
  `;

  const countQuery = `
    SELECT count() AS total
    FROM scanner_label_results
    ${where}
  `;

  const [dataResp, countResp] = await Promise.all([
    ch.query({ query: dataQuery, query_params: params, format: 'JSONEachRow' }),
    ch.query({ query: countQuery, query_params: params, format: 'JSONEachRow' }),
  ]);

  const rows = (await dataResp.json()) as ScanLabelRow[];
  const [countRow] = (await countResp.json()) as Array<{ total: string }>;
  const total = Number(countRow?.total ?? 0);

  // Enrich with Postgres review state in one round trip per table.
  const workflowIds = Array.from(new Set(rows.map((r) => r.workflowId)));
  if (workflowIds.length === 0) return { rows: [], total };

  const [scanReviews, labelReviews] = await Promise.all([
    dbRead.scannerScanReview.findMany({
      where: { workflowId: { in: workflowIds } },
      select: { workflowId: true },
    }),
    dbRead.scannerReview.findMany({
      where: { workflowId: { in: workflowIds } },
      select: { workflowId: true, label: true, verdict: true },
    }),
  ]);

  const reviewedSet = new Set(scanReviews.map((r) => r.workflowId));
  const verdictMap = new Map<string, ReviewVerdict>();
  for (const v of labelReviews) verdictMap.set(`${v.workflowId}::${v.label}`, v.verdict);

  return {
    rows: rows.map((r) => ({
      ...r,
      hasScanReview: reviewedSet.has(r.workflowId),
      labelVerdict: verdictMap.get(`${r.workflowId}::${r.label}`) ?? null,
    })),
    total,
  };
}

export async function getScanDetail(input: { workflowId: string }) {
  const ch = ensureClickhouse();
  const resp = await ch.query({
    query: `
      SELECT
        workflowId, scanner, entityType, entityId, createdAt,
        label, labelValue, score, threshold, triggered,
        policyVersion, modelVersion, modelReason,
        matchedText, matchedPositivePrompt, matchedNegativePrompt
      FROM scanner_label_results
      WHERE workflowId = {workflowId:String}
      ORDER BY triggered DESC, score DESC
    `,
    query_params: { workflowId: input.workflowId },
    format: 'JSONEachRow',
  });
  const rows = (await resp.json()) as ScanLabelRow[];

  const [labelVerdicts, scanReviews] = await Promise.all([
    dbRead.scannerReview.findMany({
      where: { workflowId: input.workflowId },
      select: {
        label: true,
        reviewedBy: true,
        reviewedAt: true,
        verdict: true,
        note: true,
      },
    }),
    dbRead.scannerScanReview.findMany({
      where: { workflowId: input.workflowId },
      select: {
        reviewedBy: true,
        reviewedAt: true,
        note: true,
      },
    }),
  ]);

  return { rows, labelVerdicts, scanReviews };
}

export async function upsertLabelVerdict(input: {
  workflowId: string;
  label: string;
  verdict: ReviewVerdict;
  note?: string;
  userId: number;
}) {
  return dbWrite.scannerReview.upsert({
    where: {
      workflowId_label_reviewedBy: {
        workflowId: input.workflowId,
        label: input.label,
        reviewedBy: input.userId,
      },
    },
    create: {
      workflowId: input.workflowId,
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
  workflowId: string;
  label: string;
  userId: number;
}) {
  await dbWrite.scannerReview.deleteMany({
    where: {
      workflowId: input.workflowId,
      label: input.label,
      reviewedBy: input.userId,
    },
  });
}

export async function submitScanReview(input: {
  workflowId: string;
  note?: string;
  userId: number;
}) {
  return dbWrite.scannerScanReview.upsert({
    where: {
      workflowId_reviewedBy: {
        workflowId: input.workflowId,
        reviewedBy: input.userId,
      },
    },
    create: {
      workflowId: input.workflowId,
      reviewedBy: input.userId,
      note: input.note,
    },
    update: {
      note: input.note,
      reviewedAt: new Date(),
    },
  });
}
