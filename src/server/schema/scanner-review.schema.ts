import * as z from 'zod';
import { ReviewVerdict } from '~/shared/utils/prisma/enums';

export const scannerSchema = z.enum(['xguard_text', 'xguard_prompt', 'image_ingestion']);
export type Scanner = z.infer<typeof scannerSchema>;

export const queueViewSchema = z.enum(['triggered', 'near-miss']);
export type QueueView = z.infer<typeof queueViewSchema>;

export const listScansSchema = z.object({
  scanner: scannerSchema.optional(),
  view: queueViewSchema.default('triggered'),
  label: z.string().optional(),
  version: z.string().optional(),
  /** For near-miss view: only return rows where score >= this fraction of threshold. */
  nearMissFloor: z.number().min(0).max(1).default(0.5),
  /** Partition-prune window. Defaults to 30 days on the server. */
  lookbackDays: z.number().int().min(1).max(365).optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
});

export const getScanDetailSchema = z.object({
  contentHash: z.string().min(1),
  version: z.string(),
  lookbackDays: z.number().int().min(1).max(365).optional(),
});

export const upsertLabelVerdictSchema = z.object({
  contentHash: z.string().min(1),
  version: z.string(),
  label: z.string().min(1),
  verdict: z.nativeEnum(ReviewVerdict),
  note: z.string().max(2000).optional(),
});

export const deleteLabelVerdictSchema = z.object({
  contentHash: z.string().min(1),
  version: z.string(),
  label: z.string().min(1),
});

export const exportRowsSchema = listScansSchema.extend({
  limit: z.number().int().min(1).max(50000).default(10000),
});
