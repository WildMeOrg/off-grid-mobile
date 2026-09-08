import { deploymentConfig } from './deployment';

export const ENTRA_TENANT_ID = deploymentConfig.tenantId;
export const ENTRA_ISSUER = `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0`;
export const ENTRA_MOBILE_CLIENT_ID = deploymentConfig.mobileClientId;
export const ENTRA_API_APP_ID = deploymentConfig.apiClientId;
export const ENTRA_REDIRECT_URL = deploymentConfig.redirectUrl;
export const ENTRA_SCOPES = ['openid', 'profile', 'offline_access', `api://${ENTRA_API_APP_ID}/access_as_user`];
