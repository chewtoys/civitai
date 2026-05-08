import { protectedProcedure, router } from '~/server/trpc';
import { hideDownloadInput } from '~/server/schema/download.schema';
import {
  getUserDownloadsHandler,
  hideDownloadHandler,
} from '~/server/controllers/download.controller';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const downloadRouter = router({
  getAllByUser: protectedProcedure
    .meta({ requiredScope: TokenScope.ModelsRead })
    .query(getUserDownloadsHandler),
  hide: protectedProcedure
    .meta({ requiredScope: TokenScope.ModelsRead })
    .input(hideDownloadInput)
    .mutation(hideDownloadHandler),
});
