import { useMemo, useState } from 'react';
import {
  Loader2,
  Key,
  Plug,
  ShieldCheck,
  Sparkles,
  Briefcase,
  Bot,
  AlertCircle,
  CheckCircle2,
  Plus,
  Trash2,
  ChevronDown,
  Eye,
  EyeOff,
  Settings,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { providerDisplayStatus, type ProviderState } from '@/lib/providerStatus';
import {
  useWorkspaceProviders,
  useToggleWorkspaceProvider,
  useSetProviderCredential,
  useTestProviderConnection,
  useCreateProvider,
  useDeleteProvider,
  type ProviderCategory,
  type WorkspaceProvider,
  type ProviderTestResult,
} from '@/hooks/useWorkspaceProviders';
import { useCurrentWorkspaceId } from '@/hooks/useCurrentWorkspaceId';
import {
  useWorkspaceSettings,
  useUpdateWorkspaceSetting,
  type WorkspaceSettings,
} from '@/hooks/useWorkspaceSettings';

const CATEGORY_META: Record<
  ProviderCategory,
  { label: string; description: string; icon: typeof Plug }
> = {
  outreach: {
    label: 'Envoi',
    description: "Provider d'envoi de messages (Smartlead).",
    icon: Plug,
  },
  validator: {
    label: 'Validation email',
    description: 'Vérifie la délivrabilité avant envoi (Bouncer, ZeroBounce...).',
    icon: ShieldCheck,
  },
  enricher: {
    label: 'Enrichissement',
    description: "Résout les contacts d'une entreprise (FullEnrich, Dropcontact...).",
    icon: Sparkles,
  },
  source: {
    label: 'Sources',
    description: "Sources d'offres et signaux scrappés (Adzuna, France Travail, Apify LinkedIn...).",
    icon: Briefcase,
  },
  llm: {
    label: 'Modèle IA',
    description: 'Modèle de langage pour le scoring et les messages (Claude, Mistral...).',
    icon: Bot,
  },
};

const PROVIDER_LABELS: Record<string, string> = {
  smartlead: 'Smartlead',
  microsoft_graph: 'Microsoft Graph',
  resend: 'Resend',
  bouncer: 'Bouncer',
  reoon: 'Reoon',
  fullenrich: 'FullEnrich',
  anthropic: 'Anthropic (Claude)',
  openai_compatible: 'OpenAI-compatible (OpenAI, Mistral)',
  adzuna: 'Adzuna',
  france_travail: 'France Travail',
  apify_linkedin: 'Apify (LinkedIn Jobs)',
  demo: 'Mode demo (fake data)',
};

const PROVIDER_OPTIONS: Record<ProviderCategory, string[]> = {
  outreach: ['smartlead', 'demo'],
  validator: ['bouncer', 'reoon', 'demo'],
  enricher: ['fullenrich', 'demo'],
  source: ['adzuna', 'france_travail', 'apify_linkedin', 'demo'],
  llm: ['anthropic', 'openai_compatible', 'demo'],
};

// Champs de credential par provider_type. Les clés DOIVENT matcher ce que le
// backend attend (config.fallback_env / resolveCredential). Défaut = une seule clé API.
// `secret: false` = affiché en clair (URL, noms de modèles... masquer n'a aucun sens).
type CredentialField = { key: string; label: string; secret?: boolean; placeholder?: string };
const CREDENTIAL_FIELDS: Record<string, CredentialField[]> = {
  adzuna: [
    { key: 'app_id', label: 'Application ID', secret: false },
    { key: 'app_key', label: 'Application Key' },
  ],
  france_travail: [
    { key: 'client_id', label: 'Identifiant client', secret: false },
    { key: 'client_secret', label: 'Clé secrète' },
  ],
  apify_linkedin: [
    { key: 'api_token', label: 'Token API Apify' },
    { key: 'actor_id', label: 'Actor ID (optionnel)', secret: false, placeholder: 'valig~linkedin-jobs-scraper' },
  ],
  openai_compatible: [
    { key: 'api_key', label: 'Clé API' },
    { key: 'base_url', label: 'Base URL', secret: false, placeholder: 'https://api.mistral.ai/v1' },
    { key: 'model_fast', label: 'Modèle rapide (micro-tâches)', secret: false, placeholder: 'mistral-small-latest' },
    { key: 'model_smart', label: 'Modèle avancé (scoring, imports)', secret: false, placeholder: 'mistral-large-latest' },
  ],
};
const DEFAULT_CREDENTIAL_FIELDS: CredentialField[] = [{ key: 'api_key', label: 'Clé API' }];

// Presets OpenAI-compatible : pré-remplit base_url + modèles, il ne reste que
// la clé à coller. « Autre » = tout à la main (vLLM, serveur custom...).
const OPENAI_COMPAT_PRESETS: Array<{ label: string; values: Record<string, string> }> = [
  { label: 'Mistral', values: { base_url: 'https://api.mistral.ai/v1', model_fast: 'mistral-small-latest', model_smart: 'mistral-large-latest' } },
  { label: 'OpenAI', values: { base_url: 'https://api.openai.com/v1', model_fast: 'gpt-5.4-mini', model_smart: 'gpt-5.5' } },
];

export function ProspectionProviders() {
  const { data: providers, isLoading } = useWorkspaceProviders();
  const toggle = useToggleWorkspaceProvider();
  const { data: currentWorkspaceId } = useCurrentWorkspaceId();
  const { data: settings } = useWorkspaceSettings();
  const updateSetting = useUpdateWorkspaceSetting();
  const [addingCategory, setAddingCategory] = useState<ProviderCategory | null>(null);

  const grouped = useMemo(() => {
    const map: Record<ProviderCategory, WorkspaceProvider[]> = {
      outreach: [],
      validator: [],
      enricher: [],
      source: [],
      llm: [],
    };
    // Garde-fou : une catégorie inconnue (provider seedé hors UI) ne doit jamais
    // crasher la page — on l'ignore silencieusement plutôt que de déréférencer undefined.
    for (const p of providers ?? []) map[p.category]?.push(p);
    return map;
  }, [providers]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  async function handleToggle(id: string, next: boolean) {
    try {
      await toggle.mutateAsync({ id, is_active: next });
      toast.success(next ? 'Provider activé' : 'Provider désactivé');
    } catch (err) {
      toast.error('Échec', { description: err instanceof Error ? err.message : 'Erreur inconnue' });
    }
  }

  // Le bouton « Ajouter » doit s'afficher même sans provider seedé : on prend le
  // workspace de l'user courant, pas celui d'un provider existant (sinon catch-22
  // sur une instance vierge où la liste est vide).
  const firstWorkspaceId = currentWorkspaceId ?? providers?.[0]?.workspace_id ?? null;

  return (
    <div className="max-w-2xl space-y-10">
      <header className="flex items-center gap-3">
        <Key className="w-5 h-5 text-violet-500" />
        <div>
          <h2 className="text-lg font-semibold text-foreground">Providers</h2>
          <p className="text-sm text-muted-foreground">
            Services externes utilisés par la prospection. Les clés sont chiffrées et stockées côté workspace.
          </p>
        </div>
      </header>

      {/* Section : Options du workspace */}
      <WorkspaceSettingsSection settings={settings} updateSetting={updateSetting} />

      {(Object.entries(grouped) as Array<[ProviderCategory, WorkspaceProvider[]]>).map(([category, rows]) => {
        const meta = CATEGORY_META[category];
        const Icon = meta.icon;
        return (
          <section key={category} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Icon className="w-4 h-4 text-violet-500 mt-1 shrink-0" />
                <div className="space-y-1">
                  <h3 className="font-medium text-foreground leading-none">{meta.label}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{meta.description}</p>
                </div>
              </div>
              {firstWorkspaceId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 shrink-0"
                  onClick={() => setAddingCategory(category)}
                  disabled={addingCategory === category}
                >
                  <Plus className="w-3.5 h-3.5" /> Ajouter
                </Button>
              )}
            </div>

            {addingCategory === category && firstWorkspaceId && (
              <AddProviderRow
                category={category}
                workspaceId={firstWorkspaceId}
                onClose={() => setAddingCategory(null)}
              />
            )}

            {rows.length === 0 && addingCategory !== category ? (
              <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">Aucun provider configuré.</p>
                <p className="text-xs text-muted-foreground/80 mt-1">
                  Clique sur Ajouter pour en créer un.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {rows.map((p) => (
                  <ProviderRow key={p.id} provider={p} onToggle={handleToggle} disabled={toggle.isPending} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ProviderRow({
  provider,
  onToggle,
  disabled,
}: {
  provider: WorkspaceProvider;
  onToggle: (id: string, next: boolean) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = PROVIDER_LABELS[provider.provider_type] ?? provider.provider_type;
  const status = providerDisplayStatus(provider);

  return (
    <div className="rounded-md border border-border/60 bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <ChevronDown
          className={cn(
            'w-4 h-4 text-muted-foreground transition-transform shrink-0',
            expanded && 'rotate-180'
          )}
        />
        <div className="flex-1 min-w-0 space-y-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{label}</span>
            {provider.channel && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                {provider.channel}
              </Badge>
            )}
            <StatusPill state={status.state} label={status.label} />
          </div>
          {!expanded && status.detail && (
            <div className="text-xs text-muted-foreground">{status.detail}</div>
          )}
        </div>
        <Switch
          checked={provider.is_active}
          onCheckedChange={(checked) => onToggle(provider.id, checked)}
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
        />
      </button>

      {expanded && <ProviderRowDetails provider={provider} />}
    </div>
  );
}

function ProviderRowDetails({ provider }: { provider: WorkspaceProvider }) {
  const setCredential = useSetProviderCredential();
  const testConnection = useTestProviderConnection();
  const deleteProvider = useDeleteProvider();
  const fields = CREDENTIAL_FIELDS[provider.provider_type] ?? DEFAULT_CREDENTIAL_FIELDS;
  const multiField = fields.length > 1;
  const [values, setValues] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);

  const isDemo = provider.provider_type === 'demo';
  const isConfigured = Boolean(provider.credential_last4);
  const allFilled = fields.every((f) => (values[f.key] ?? '').trim().length > 0);

  async function handleSaveKey() {
    if (!allFilled) return;
    try {
      const credentials = Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? '').trim()]));
      await setCredential.mutateAsync({ provider_id: provider.id, credentials });
      toast.success(multiField ? 'Identifiants enregistrés' : 'Clé enregistrée');
      setValues({});
      setShowKey(false);
    } catch (err) {
      toast.error('Échec', { description: err instanceof Error ? err.message : 'Erreur inconnue' });
    }
  }

  async function handleTest() {
    try {
      const result = await testConnection.mutateAsync({ provider_id: provider.id });
      setTestResult(result);
      if (result.ok) {
        toast.success(`Connexion OK (${result.latency_ms}ms)`);
      } else {
        toast.error('Test échoué', { description: result.error });
      }
    } catch (err) {
      toast.error('Test impossible', { description: err instanceof Error ? err.message : 'Erreur' });
    }
  }

  async function handleDelete() {
    if (!confirm(`Supprimer le provider "${provider.provider_type}" ?`)) return;
    try {
      await deleteProvider.mutateAsync({ id: provider.id });
      toast.success('Provider supprimé');
    } catch (err) {
      toast.error('Échec', { description: err instanceof Error ? err.message : 'Erreur inconnue' });
    }
  }

  return (
    <div className="px-4 pb-4 pt-2 space-y-4 border-t border-border/60 bg-muted/10">
      {!isDemo && (
        <div className="space-y-2">
          <Label className="text-xs">
            {isConfigured ? 'Remplacer' : multiField ? 'Identifiants' : 'Clé API'}
          </Label>
          {provider.provider_type === 'openai_compatible' && (
            <div className="flex flex-wrap items-center gap-1.5 pb-1">
              <span className="text-[11px] text-muted-foreground/80">Pré-remplir :</span>
              {OPENAI_COMPAT_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setValues((v) => ({ ...v, ...preset.values }))}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          )}
          {fields.map((field) => {
            const isSecret = field.secret !== false;
            return (
              <div key={field.key} className="space-y-1">
                {multiField && (
                  <span className="block text-[11px] text-muted-foreground/80">{field.label}</span>
                )}
                <div className="relative">
                  <Input
                    id={`cred-${provider.id}-${field.key}`}
                    type={isSecret && !showKey ? 'password' : 'text'}
                    value={values[field.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    placeholder={
                      field.placeholder
                        ?? (isConfigured && isSecret
                          ? `••••••••${provider.credential_last4}`
                          : `Coller ${field.label.toLowerCase()}...`)
                    }
                    className={cn('font-mono text-xs', isSecret && 'pr-9')}
                    autoComplete="off"
                  />
                  {isSecret && (
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showKey ? 'Masquer' : 'Afficher'}
                    >
                      {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-2 pt-1">
            <Button
              onClick={handleSaveKey}
              disabled={!allFilled || setCredential.isPending}
              size="sm"
            >
              {setCredential.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Enregistrer
            </Button>
            <p className="text-[11px] text-muted-foreground/80">
              Chiffré et stocké côté workspace, récupéré à runtime.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testConnection.isPending}
        >
          {testConnection.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          Tester la connexion
        </Button>
        {testResult && (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs',
              testResult.ok ? 'text-emerald-500' : 'text-red-500'
            )}
          >
            {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {testResult.ok ? `OK ${testResult.latency_ms}ms` : (testResult.error ?? 'Échec')}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border/40">
        <div className="text-[11px] text-muted-foreground space-y-0.5">
          {provider.credential_set_at && (
            <div>Clé définie : {new Date(provider.credential_set_at).toLocaleString('fr-FR')}</div>
          )}
          {provider.last_test_at && (
            <div>Dernier test : {new Date(provider.last_test_at).toLocaleString('fr-FR')} — {provider.last_test_detail}</div>
          )}
          <div>Créé : {new Date(provider.created_at).toLocaleString('fr-FR')}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
          onClick={handleDelete}
          disabled={deleteProvider.isPending}
        >
          <Trash2 className="w-3.5 h-3.5 mr-1" />
          Supprimer
        </Button>
      </div>
    </div>
  );
}

function StatusPill({ state, label }: { state: ProviderState; label: string }) {
  const tone: Record<ProviderState, string> = {
    unconfigured: 'text-muted-foreground bg-muted/40',
    untested: 'text-amber-500 bg-amber-500/10',
    ok: 'text-emerald-500 bg-emerald-500/10',
    error: 'text-red-500 bg-red-500/10',
  };
  const dot: Record<ProviderState, string> = {
    unconfigured: 'bg-muted-foreground/50',
    untested: 'bg-amber-500',
    ok: 'bg-emerald-500',
    error: 'bg-red-500',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', tone[state])}>
      <span className={cn('w-1.5 h-1.5 rounded-full', dot[state])} />
      {label}
    </span>
  );
}

function AddProviderRow({
  category,
  workspaceId,
  onClose,
}: {
  category: ProviderCategory;
  workspaceId: string;
  onClose: () => void;
}) {
  const create = useCreateProvider();
  const options = PROVIDER_OPTIONS[category];
  const [providerType, setProviderType] = useState<string>(options[0] ?? 'demo');

  async function handleCreate() {
    try {
      await create.mutateAsync({
        workspace_id: workspaceId,
        category,
        // Envoi = email pour l'instant (seul Smartlead). Un canal LinkedIn
        // viendra avec un provider dédié ; pas de sélecteur tant qu'il n'existe pas.
        provider_type: providerType,
        channel: category === 'outreach' ? 'email' : null,
      });
      toast.success('Provider créé');
      onClose();
    } catch (err) {
      toast.error('Échec', { description: err instanceof Error ? err.message : 'Erreur inconnue' });
    }
  }

  return (
    <div className="rounded-md border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Provider</Label>
        <Select value={providerType} onValueChange={setProviderType}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt} className="text-xs">
                {PROVIDER_LABELS[opt] ?? opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleCreate} disabled={create.isPending}>
          {create.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          Créer
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

/**
 * Section : Options du workspace
 * Affiche les toggles pour activer/désactiver les fonctionnalités optionnelles
 * comme la détection automatique des CRMs.
 */
function WorkspaceSettingsSection({
  settings,
  updateSetting,
}: {
  settings: WorkspaceSettings | undefined;
  updateSetting: ReturnType<typeof useUpdateWorkspaceSetting>;
}) {
  const crmDetectionEnabled = settings?.crm_detection_enabled ?? false;

  const handleToggleCrmDetection = async (next: boolean) => {
    try {
      await updateSetting.mutateAsync({
        key: 'crm_detection_enabled',
        value: next,
      });
      toast.success(next ? 'Détection CRM activée' : 'Détection CRM désactivée');
    } catch (err) {
      toast.error('Échec', { description: err instanceof Error ? err.message : 'Erreur inconnue' });
    }
  };

  return (
    <section className="space-y-3 border-t border-border pt-8">
      <div className="flex items-start gap-2.5">
        <Settings className="w-4 h-4 text-violet-500 mt-1 shrink-0" />
        <div className="space-y-1 flex-1">
          <h3 className="font-medium text-foreground leading-none">Options du workspace</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Fonctionnalités optionnelles qui peuvent être activées ou désactivées selon vos besoins.
          </p>
        </div>
      </div>

      <div className="space-y-2 ml-6">
        <div className="flex items-center justify-between p-3 rounded-md border border-border/50 bg-muted/20">
          <div className="space-y-1 flex-1">
            <Label className="text-sm font-medium text-foreground cursor-pointer">
              Détection automatique des CRMs
            </Label>
            <p className="text-xs text-muted-foreground">
              Analyse le site web et les offres d'emploi pour détecter les CRMs utilisés par les prospects.
            </p>
          </div>
          <Switch
            checked={crmDetectionEnabled}
            onCheckedChange={handleToggleCrmDetection}
            disabled={updateSetting.isPending}
            className="ml-4 shrink-0"
          />
        </div>
      </div>
    </section>
  );
}
