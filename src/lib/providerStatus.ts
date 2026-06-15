import type { WorkspaceProvider } from '@/hooks/useWorkspaceProviders';

export type ProviderState = 'unconfigured' | 'untested' | 'ok' | 'error';

export interface ProviderDisplayStatus {
  state: ProviderState;
  label: string;
  detail: string | null;
}

export function providerDisplayStatus(provider: WorkspaceProvider): ProviderDisplayStatus {
  if (provider.provider_type === 'demo') {
    return { state: 'ok', label: 'Mode demo', detail: 'Aucune clé requise' };
  }
  const configured = Boolean(provider.credential_last4);
  if (!configured) {
    return { state: 'unconfigured', label: 'Non configuré', detail: null };
  }
  if (provider.last_test_status === 'ok') {
    return { state: 'ok', label: 'Connecté', detail: provider.last_test_detail ?? null };
  }
  if (provider.last_test_status === 'error') {
    return { state: 'error', label: 'Erreur', detail: provider.last_test_detail ?? null };
  }
  return { state: 'untested', label: 'Configuré, non testé', detail: null };
}
