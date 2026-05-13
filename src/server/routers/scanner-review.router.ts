import {
  deleteLabelVerdictSchema,
  exportRowsSchema,
  getScanDetailSchema,
  listScansSchema,
  submitScanReviewSchema,
  upsertLabelVerdictSchema,
} from '~/server/schema/scanner-review.schema';
import {
  deleteLabelVerdict,
  getScanDetail,
  listScans,
  submitScanReview,
  upsertLabelVerdict,
} from '~/server/services/scanner-review.service';
import { moderatorProcedure, router } from '~/server/trpc';

export const scannerReviewRouter = router({
  list: moderatorProcedure.input(listScansSchema).query(({ input }) => listScans(input)),

  detail: moderatorProcedure
    .input(getScanDetailSchema)
    .query(({ input }) => getScanDetail(input)),

  upsertVerdict: moderatorProcedure
    .input(upsertLabelVerdictSchema)
    .mutation(({ input, ctx }) => upsertLabelVerdict({ ...input, userId: ctx.user.id })),

  deleteVerdict: moderatorProcedure
    .input(deleteLabelVerdictSchema)
    .mutation(({ input, ctx }) => deleteLabelVerdict({ ...input, userId: ctx.user.id })),

  submitReview: moderatorProcedure
    .input(submitScanReviewSchema)
    .mutation(({ input, ctx }) => submitScanReview({ ...input, userId: ctx.user.id })),

  // Returns up to 50k rows for client-side CSV stringify + download.
  exportRows: moderatorProcedure
    .input(exportRowsSchema)
    .query(({ input }) => listScans(input)),
});
