import { TRPCError } from '@trpc/server';
import { v4 as uuidv4 } from 'uuid';
import { protectedProcedure, publicProcedure, router } from '~/server/trpc';
import { dbRead, dbWrite } from '~/server/db/client';
import { generateKey, generateSecretHash } from '~/server/utils/key-generator';
import { logOAuthEvent } from '~/server/oauth/audit-log';
import {
  createOauthClientSchema,
  deleteOauthClientSchema,
  getOauthClientByIdSchema,
  rotateOauthClientSecretSchema,
  updateOauthClientSchema,
} from '~/server/schema/oauth-client.schema';
import { TokenScope } from '~/shared/constants/token-scope.constants';

export const oauthClientRouter = router({
  // Public: get client info by ID (used by consent page)
  getById: publicProcedure
    .meta({ requiredScope: TokenScope.UserRead })
    .input(getOauthClientByIdSchema)
    .query(async ({ input }) => {
      const client = await dbRead.oauthClient.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          name: true,
          description: true,
          logoUrl: true,
          isVerified: true,
          redirectUris: true,
          allowedScopes: true,
        },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: 'OAuth client not found' });
      return client;
    }),

  // Get all clients owned by the current user
  getAll: protectedProcedure.meta({ requiredScope: TokenScope.UserRead }).query(async ({ ctx }) => {
    return dbRead.oauthClient.findMany({
      where: { userId: ctx.user.id },
      select: {
        id: true,
        name: true,
        description: true,
        logoUrl: true,
        redirectUris: true,
        grants: true,
        allowedScopes: true,
        isConfidential: true,
        isVerified: true,
        createdAt: true,
        _count: { select: { tokens: true, consents: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  // Register a new OAuth client
  create: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(createOauthClientSchema)
    .mutation(async ({ ctx, input }) => {
      const clientId = uuidv4();
      const clientSecret = input.isConfidential ? generateKey(48) : null;
      const hashedSecret = clientSecret ? generateSecretHash(clientSecret) : null;

      await dbWrite.oauthClient.create({
        data: {
          id: clientId,
          secret: hashedSecret,
          name: input.name,
          description: input.description,
          redirectUris: input.redirectUris,
          isConfidential: input.isConfidential,
          allowedScopes: input.allowedScopes,
          userId: ctx.user.id,
        },
      });

      logOAuthEvent({ type: 'client.created', userId: ctx.user.id, clientId });

      return {
        clientId,
        clientSecret, // Only returned once — shown to the developer
      };
    }),

  // Update client details
  update: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(updateOauthClientSchema)
    .mutation(async ({ ctx, input }) => {
      const client = await dbWrite.oauthClient.findFirst({
        where: { id: input.id, userId: ctx.user.id },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });

      const { id, ...data } = input;
      const result = await dbWrite.oauthClient.update({ where: { id }, data });
      logOAuthEvent({ type: 'client.updated', userId: ctx.user.id, clientId: id });
      return result;
    }),

  // Rotate client secret
  rotateSecret: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(rotateOauthClientSecretSchema)
    .mutation(async ({ ctx, input }) => {
      const client = await dbWrite.oauthClient.findFirst({
        where: { id: input.id, userId: ctx.user.id, isConfidential: true },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });

      const newSecret = generateKey(48);
      const hashedSecret = generateSecretHash(newSecret);

      await dbWrite.oauthClient.update({
        where: { id: input.id },
        data: { secret: hashedSecret },
      });

      logOAuthEvent({ type: 'client.secret_rotated', userId: ctx.user.id, clientId: input.id });

      return { clientSecret: newSecret };
    }),

  // Delete a client and all associated tokens/consents
  delete: protectedProcedure
    .meta({ requiredScope: TokenScope.UserWrite })
    .input(deleteOauthClientSchema)
    .mutation(async ({ ctx, input }) => {
      const client = await dbWrite.oauthClient.findFirst({
        where: { id: input.id, userId: ctx.user.id },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });

      // Cascade delete handles tokens and consents
      await dbWrite.oauthClient.delete({ where: { id: input.id } });

      logOAuthEvent({ type: 'client.deleted', userId: ctx.user.id, clientId: input.id });

      return { success: true };
    }),
});
