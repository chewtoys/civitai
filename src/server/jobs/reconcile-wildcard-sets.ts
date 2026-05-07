import { reconcileWildcardSets } from '~/server/services/wildcard-set-provisioning.service';
import { createJob, getJobDate } from './job';

// Hourly safety net + ongoing backfill for the WildcardSet provisioning
// pipeline. The publish-time hook is the primary path; this catches anything
// that slipped through (failed imports, hooks not yet wired, pre-feature
// historical wildcard models). See docs/features/prompt-snippets-provisioning-job.md.
export const reconcileWildcardSetsJob = createJob(
  'reconcile-wildcard-sets',
  '15 * * * *',
  async () => {
    const [, setLastRun] = await getJobDate('reconcile-wildcard-sets');
    const result = await reconcileWildcardSets();
    await setLastRun();
    return result;
  }
);
