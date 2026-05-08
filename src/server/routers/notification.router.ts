import {
  getUserNotificationsInfiniteHandler,
  upsertUserNotificationSettingsHandler,
} from '~/server/controllers/notification.controller';
import {
  getUserNotificationsSchema,
  markReadNotificationInput,
  toggleNotificationSettingInput,
} from '~/server/schema/notification.schema';
import { markNotificationsRead } from '~/server/services/notification.service';
import { protectedProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const notificationRouter = router({
  getAllByUser: protectedProcedure
    .meta({ requiredScope: TokenScope.NotificationsRead })
    .input(getUserNotificationsSchema.partial())
    .query(getUserNotificationsInfiniteHandler),
  markRead: protectedProcedure
    .meta({ requiredScope: TokenScope.NotificationsWrite })
    .input(markReadNotificationInput)
    .mutation(({ input, ctx }) => markNotificationsRead({ ...input, userId: ctx.user.id })),
  updateUserSettings: protectedProcedure
    .meta({ requiredScope: TokenScope.NotificationsWrite })
    .input(toggleNotificationSettingInput)
    .mutation(upsertUserNotificationSettingsHandler),
});
