import OAuth2Server from '@node-oauth/oauth2-server';
import { oauthModel } from './model';

export const oauthServer = new OAuth2Server({
  model: oauthModel,
  accessTokenLifetime: 60 * 60, // 1 hour
  refreshTokenLifetime: 30 * 24 * 60 * 60, // 30 days
  allowEmptyState: false,
  requireClientAuthentication: {
    authorization_code: false, // PKCE handles security for public clients
    refresh_token: false, // Public clients (SPAs) need to refresh without a secret
  },
});
