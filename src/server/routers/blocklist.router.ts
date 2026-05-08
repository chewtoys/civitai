import { router, moderatorProcedure } from '~/server/trpc';

import {
  getBlocklistSchema,
  removeBlocklistItemSchema,
  upsertBlocklistSchema,
} from '~/server/schema/blocklist.schema';
import {
  getBlocklistDTO,
  removeBlocklistItems,
  upsertBlocklist,
} from '~/server/services/blocklist.service';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const blocklistRouter = router({
  upsertBlocklist: moderatorProcedure
    .input(upsertBlocklistSchema)
    .mutation(({ input }) => upsertBlocklist(input)),
  removeItems: moderatorProcedure
    .input(removeBlocklistItemSchema)
    .mutation(({ input }) => removeBlocklistItems(input)),
  getBlocklist: moderatorProcedure
    .input(getBlocklistSchema)
    .query(({ input }) => getBlocklistDTO(input)),
});
