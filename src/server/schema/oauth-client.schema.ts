import { TokenScope } from '~/shared/constants/token-scope.constants';
import * as z from 'zod';

export const getOauthClientByIdSchema = z.object({ id: z.string() });
export type GetOauthClientByIdInput = z.infer<typeof getOauthClientByIdSchema>;

export const createOauthClientSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(500).default(''),
  redirectUris: z.array(z.string().url()).min(1),
  isConfidential: z.boolean().default(true),
  allowedScopes: z.number().int().min(0).max(TokenScope.Full).default(TokenScope.Full),
});
export type CreateOauthClientInput = z.infer<typeof createOauthClientSchema>;

export const updateOauthClientSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(500).optional(),
  redirectUris: z.array(z.string().url()).min(1).optional(),
  allowedScopes: z.number().int().min(0).max(TokenScope.Full).optional(),
});
export type UpdateOauthClientInput = z.infer<typeof updateOauthClientSchema>;

export const deleteOauthClientSchema = z.object({ id: z.string() });
export type DeleteOauthClientInput = z.infer<typeof deleteOauthClientSchema>;

export const rotateOauthClientSecretSchema = z.object({ id: z.string() });
export type RotateOauthClientSecretInput = z.infer<typeof rotateOauthClientSecretSchema>;
