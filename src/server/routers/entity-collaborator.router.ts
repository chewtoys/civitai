import {
  actionEntityCollaboratorInviteInput,
  getEntityCollaboratorsInput,
  removeEntityCollaboratorInput,
  upsertEntityCollaboratorInput,
} from '~/server/schema/entity-collaborator.schema';
import {
  actionEntityCollaborationInvite,
  getEntityCollaborators,
  removeEntityCollaborator,
  upsertEntityCollaborator,
} from '~/server/services/entity-collaborator.service';
import { protectedProcedure, publicProcedure, router } from '~/server/trpc';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const entityCollaboratorRouter = router({
  upsert: protectedProcedure
    .meta({ requiredScope: TokenScope.ModelsWrite })
    .input(upsertEntityCollaboratorInput)
    .mutation(({ input, ctx }) => upsertEntityCollaborator({ ...input, userId: ctx.user.id })),
  get: publicProcedure
    .meta({ requiredScope: TokenScope.ModelsRead })
    .input(getEntityCollaboratorsInput)
    .query(({ input, ctx }) =>
      getEntityCollaborators({ ...input, userId: ctx.user?.id, isModerator: ctx.user?.isModerator })
    ),
  remove: protectedProcedure
    .meta({ requiredScope: TokenScope.ModelsWrite })
    .input(removeEntityCollaboratorInput)
    .mutation(({ input, ctx }) =>
      removeEntityCollaborator({ ...input, userId: ctx.user.id, isModerator: ctx.user.isModerator })
    ),
  action: protectedProcedure
    .meta({ requiredScope: TokenScope.ModelsWrite })
    .input(actionEntityCollaboratorInviteInput)
    .mutation(({ input, ctx }) =>
      actionEntityCollaborationInvite({
        ...input,
        userId: ctx.user.id,
      })
    ),
});
