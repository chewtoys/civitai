import { logToAxiom } from '~/server/logging/client';
import { submitPendingWildcardCategoryAudits } from '~/server/services/wildcard-category-audit.service';
import { createJob, getJobDate } from './job';

// Safety net for the import-time audit fire-and-forget. Picks up
// `WildcardSetCategory` rows that are still `Pending` and have no in-flight
// orchestrator workflow (per `metadata.workflowId`). Categories whose retry
// counter has hit `MAX_RETRY` in the audit service are skipped so a
// permanently broken submission doesn't loop. Capped per call; rerun until
// `submitted + skipped` == 0 to drain.
//
// Schedule: hourly at :25. Offset from the top-of-hour `reconcile-wildcard-sets`
// job (which runs at :15) so the audit pass picks up Pending categories the
// reconciler created on its previous tick rather than racing it.
export const auditWildcardSetCategoriesJob = createJob(
  'audit-wildcard-set-categories',
  '25 * * * *',
  async () => {
    const [, setLastRun] = await getJobDate('audit-wildcard-set-categories');
    const result = await submitPendingWildcardCategoryAudits();
    await setLastRun();

    if (result.skipped > 0 || result.markedCleanEmpty > 0) {
      logToAxiom({
        type: 'wildcard-category-audit',
        name: 'audit-wildcard-set-categories',
        level: 'info',
        message: 'periodic audit submission pass',
        ...result,
      }).catch(() => undefined);
    }

    return result;
  }
);
