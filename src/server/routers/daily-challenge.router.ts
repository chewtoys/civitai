import {
  getAllDailyChallenges,
  getCurrentDailyChallenge,
} from '~/server/services/daily-challenge.service';
import { isFlagProtected, publicProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const dailyChallengeRouter = router({
  getAll: publicProcedure
    .meta({ requiredScope: TokenScope.MediaRead })
    .use(isFlagProtected('challengePlatform'))
    .query(() => getAllDailyChallenges()),
  getCurrent: publicProcedure
    .meta({ requiredScope: TokenScope.MediaRead })
    .use(isFlagProtected('challengePlatform'))
    .query(() => getCurrentDailyChallenge()),
});
