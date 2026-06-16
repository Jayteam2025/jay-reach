import { useMemo } from 'react';
import { Loader2, Megaphone, AlertCircle, RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useIcpPersonas } from '@/hooks/useIcpPersonas';
import { useCurrentWorkspaceId } from '@/hooks/useCurrentWorkspaceId';
import {
  useSmartleadCampaignMappings,
  useSmartleadCampaignList,
  useUpsertSmartleadCampaign,
  useDeleteSmartleadCampaign,
  type SmartleadCampaignMapping,
  type SmartleadCampaignOption,
} from '@/hooks/useSmartleadCampaigns';

const NONE = '__none__';

export function ProspectionCampaigns() {
  const { data: personas, isLoading: personasLoading } = useIcpPersonas();
  const { data: workspaceId } = useCurrentWorkspaceId();
  const { data: mappings } = useSmartleadCampaignMappings();
  const list = useSmartleadCampaignList();

  const activePersonas = useMemo(
    () => (personas ?? []).filter((p) => p.is_active),
    [personas],
  );

  const mappingByPersona = useMemo(() => {
    const m: Record<string, SmartleadCampaignMapping> = {};
    for (const row of mappings ?? []) m[row.persona_id] = row;
    return m;
  }, [mappings]);

  const campaigns: SmartleadCampaignOption[] = list.data?.ok ? (list.data.campaigns ?? []) : [];
  const listError = list.data && !list.data.ok ? list.data.error : null;

  return (
    <div className="max-w-2xl space-y-6">
      <header className="flex items-center gap-3">
        <Megaphone className="w-5 h-5 text-violet-500" />
        <div>
          <h2 className="text-lg font-semibold text-foreground">Campagnes Smartlead</h2>
          <p className="text-sm text-muted-foreground">
            Associe chaque persona à une campagne Smartlead. Les contacts validés d'un persona sont
            poussés dans la campagne correspondante (sujet et corps injectés via {'{{subject}}'} / {'{{body}}'}).
          </p>
        </div>
      </header>

      {personasLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : activePersonas.length === 0 ? (
        <EmptyState
          title="Aucun persona actif"
          hint="Crée d'abord tes personas dans l'onglet « Personas », puis reviens ici pour les relier à tes campagnes Smartlead."
        />
      ) : (
        <>
          {listError && (
            <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <p className="text-sm text-amber-600 dark:text-amber-400">{listError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-7"
                  onClick={() => list.refetch()}
                  disabled={list.isFetching}
                >
                  {list.isFetching ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Réessayer
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {activePersonas.map((persona) => (
              <PersonaCampaignRow
                key={persona.id}
                personaId={persona.id}
                personaLabel={persona.label}
                workspaceId={workspaceId ?? null}
                mapping={mappingByPersona[persona.id] ?? null}
                campaigns={campaigns}
                campaignsLoading={list.isLoading}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PersonaCampaignRow({
  personaId,
  personaLabel,
  workspaceId,
  mapping,
  campaigns,
  campaignsLoading,
}: {
  personaId: string;
  personaLabel: string;
  workspaceId: string | null;
  mapping: SmartleadCampaignMapping | null;
  campaigns: SmartleadCampaignOption[];
  campaignsLoading: boolean;
}) {
  const upsert = useUpsertSmartleadCampaign();
  const remove = useDeleteSmartleadCampaign();
  const busy = upsert.isPending || remove.isPending;

  // La campagne mappée peut ne pas être dans la liste live (supprimée côté
  // Smartlead, ou liste indisponible) : on l'ajoute pour ne pas masquer le lien.
  const options = useMemo(() => {
    const opts = [...campaigns];
    if (mapping && !opts.some((c) => String(c.id) === mapping.campaign_id)) {
      opts.unshift({
        id: Number(mapping.campaign_id) || 0,
        name: mapping.campaign_name || `Campagne ${mapping.campaign_id}`,
        status: '',
      });
    }
    return opts;
  }, [campaigns, mapping]);

  async function handleSelect(value: string) {
    if (!workspaceId) {
      toast.error('Workspace introuvable');
      return;
    }
    try {
      if (value === NONE) {
        if (mapping) {
          await remove.mutateAsync(mapping.id);
          toast.success(`« ${personaLabel} » : campagne retirée`);
        }
        return;
      }
      const opt = options.find((c) => String(c.id) === value);
      await upsert.mutateAsync({
        workspace_id: workspaceId,
        persona_id: personaId,
        campaign_id: value,
        campaign_name: opt?.name ?? null,
        enabled: mapping?.enabled ?? true,
      });
      toast.success(`« ${personaLabel} » → ${opt?.name ?? value}`);
    } catch (err) {
      toast.error('Échec', { description: err instanceof Error ? err.message : 'Erreur inconnue' });
    }
  }

  async function handleToggleEnabled(next: boolean) {
    if (!mapping || !workspaceId) return;
    try {
      await upsert.mutateAsync({
        workspace_id: workspaceId,
        persona_id: personaId,
        campaign_id: mapping.campaign_id,
        campaign_name: mapping.campaign_name,
        enabled: next,
      });
      toast.success(next ? 'Push activé pour ce persona' : 'Push désactivé pour ce persona');
    } catch (err) {
      toast.error('Échec', { description: err instanceof Error ? err.message : 'Erreur inconnue' });
    }
  }

  return (
    <div className="flex items-center gap-4 rounded-md border border-border/60 bg-card px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{personaLabel}</div>
        <div className="text-xs text-muted-foreground">
          {mapping
            ? mapping.enabled
              ? 'Relié — push actif'
              : 'Relié — push en pause'
            : 'Aucune campagne reliée'}
        </div>
      </div>

      <Select
        value={mapping?.campaign_id ?? NONE}
        onValueChange={handleSelect}
        disabled={busy}
      >
        <SelectTrigger className="w-64 h-9 text-xs">
          <SelectValue placeholder={campaignsLoading ? 'Chargement…' : 'Choisir une campagne'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE} className="text-xs text-muted-foreground">
            Aucune campagne
          </SelectItem>
          {options.map((c) => (
            <SelectItem key={c.id} value={String(c.id)} className="text-xs">
              {c.name}
              {c.status ? <span className="text-muted-foreground/70"> · {c.status.toLowerCase()}</span> : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Switch
        checked={Boolean(mapping?.enabled)}
        onCheckedChange={handleToggleEnabled}
        disabled={!mapping || busy}
        aria-label="Activer le push pour ce persona"
      />
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-4 py-8 text-center">
      <p className="text-sm text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">{hint}</p>
    </div>
  );
}
