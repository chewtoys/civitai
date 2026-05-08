import {
  trackActionSchema,
  trackSearchSchema,
  trackShareSchema,
  addViewSchema,
} from '~/server/schema/track.schema';
import { publicProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const trackRouter = router({
  addView: publicProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(addViewSchema)
    .mutation(({ input, ctx }) => ctx.track.view(input)),
  trackShare: publicProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(trackShareSchema)
    .mutation(({ input, ctx }) => ctx.track.share(input)),
  addAction: publicProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(trackActionSchema)
    .mutation(({ input, ctx }) => ctx.track.action(input)),
  trackSearch: publicProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(trackSearchSchema)
    .mutation(({ input, ctx }) => ctx.track.search(input)),
});
