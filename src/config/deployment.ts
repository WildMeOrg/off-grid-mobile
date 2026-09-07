import generated from './deployment.generated.json';

interface DeploymentConfiguration {
  apiBaseUrl: string;
  projectId: string;
  tenantId: string;
  mobileClientId: string;
  apiClientId: string;
  redirectUrl: string;
}

export const deploymentConfig: Readonly<DeploymentConfiguration> = Object.freeze(generated);

export function getTokenStorageService(config: Readonly<DeploymentConfiguration>): string {
  const deploymentKey = [
    config.apiBaseUrl,
    config.projectId,
    config.tenantId,
    config.mobileClientId,
    config.apiClientId,
    config.redirectUrl,
  ].map(encodeURIComponent).join('|');
  return `org.ganesha.elebook.entra.${deploymentKey}`;
}