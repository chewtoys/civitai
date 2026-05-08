import { CacheTTL } from '~/server/common/constants';
import { cacheIt, edgeCacheIt } from '~/server/middleware.trpc';
import type { GetLeaderboardInput } from '~/server/schema/leaderboard.schema';
import {
  getLeaderboardPositionsSchema,
  getLeaderboardSchema,
} from '~/server/schema/leaderboard.schema';
import {
  getLeaderboard,
  getLeaderboards,
  getLeaderboardPositions,
  getLeaderboardLegends,
} from '~/server/services/leaderboard.service';
import { publicProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

const leaderboardEdgeCache = edgeCacheIt({
  ttl: CacheTTL.xs,
});

export const leaderboardRouter = router({
  getLeaderboards: publicProcedure
    .meta({ requiredScope: TokenScope.MediaRead })
    .query(({ ctx }) => getLeaderboards({ isModerator: ctx?.user?.isModerator ?? false })),
  getLeaderboardPositions: publicProcedure
    .meta({ requiredScope: TokenScope.MediaRead })
    .input(getLeaderboardPositionsSchema)
    .use(cacheIt({ ttl: CacheTTL.day, tags: () => ['leaderboard', 'leaderboard-positions'] }))
    .query(({ input, ctx }) =>
      getLeaderboardPositions({
        ...input,
        userId: input.userId,
        isModerator: ctx?.user?.isModerator ?? false,
      })
    ),
  getLeaderboard: publicProcedure
    .meta({ requiredScope: TokenScope.MediaRead })
    .input(getLeaderboardSchema)
    .use(
      cacheIt({
        ttl: CacheTTL.day,
        tags: (input: GetLeaderboardInput) => ['leaderboard', `leaderboard-${input.id}`],
      })
    )
    .use(leaderboardEdgeCache)
    .query(({ input, ctx }) =>
      getLeaderboard({ ...input, isModerator: ctx?.user?.isModerator ?? false })
    ),
  getLeadboardLegends: publicProcedure
    .meta({ requiredScope: TokenScope.MediaRead })
    .input(getLeaderboardSchema)
    .use(
      cacheIt({
        ttl: CacheTTL.day,
        tags: (input: GetLeaderboardInput) => [
          'leaderboard',
          `leaderboard-${input.id}`,
          `leaderboard-${input.id}-legends`,
        ],
      })
    )
    .use(leaderboardEdgeCache)
    .query(({ input, ctx }) =>
      getLeaderboardLegends({ ...input, isModerator: ctx?.user?.isModerator ?? false })
    ),
});
