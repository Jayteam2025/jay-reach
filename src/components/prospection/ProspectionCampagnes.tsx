import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Linkedin,
  Loader2,
  Mail,
  MailOpen,
  MessageSquare,
  Pencil,
  PenLine,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { glassPop, staggerProps } from '@/lib/motion';
import { useCurrentWorkspaceId } from '@/hooks/useCurrentWorkspaceId';
import { useIcpPersonas } from '@/hooks/useIcpPersonas';
import { useSmartleadCampaignMappings } from '@/hooks/useSmartleadCampaigns';
import { useSmartleadCampaignStats } from '@/hooks/useSmartleadCampaignStats';
import {
  Campaign,
  CampaignStep,
  StepChannel,
  defaultCampaignSteps,
  useCampaigns,
  useUpsertCampaign,
} from '@/hooks/useCampaigns';
import { AnimatedNumber } from './AnimatedNumber';
import { ProspectionCampaigns } from './ProspectionCampaigns';

const CHANNEL_META: Record<StepChannel, { icon: typeof Mail; ring: string; color: string; label: string }> = {
  email: { icon: Mail, ring: 'border-[hsl(var(--a1)/0.4)]', color: 'text-[hsl(var(--a1))]', label: 'Email' },
  linkedin: { icon: Linkedin, ring: 'border-[hsl(var(--a2)/0.4)]', color: 'text-[hsl(var(--a2))]', label: 'LinkedIn' },
  letter: { icon: PenLine, ring: 'border-[#F0997B]/40', color: 'text-[#F0997B]', label: 'Courrier' },
};

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

export function ProspectionCampagnes() {
  const { data: workspaceId } = useCurrentWorkspaceId();
  const { data: campaigns, isLoading } = useCampaigns();
  const { data: personas } = useIcpPersonas();
  const upsert = useUpsertCampaign();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activePersonas = useMemo(() => (personas ?? []).filter((p) => p.is_active), [personas]);
  const campaignByPersona = useMemo(() => {
    const m = new Map<string, Campaign>();
    (campaigns ?? []).forEach((c) => m.set(c.persona_id, c));
    return m;
  }, [campaigns]);
  const personasSansCampagne = activePersonas.filter((p) => !campaignByPersona.has(p.id));

  const selected = (campaigns ?? []).find((c) => c.id === selectedId) ?? null;

  const createFor = (personaId: string, label: string) => {
    if (!workspaceId) return;
    upsert.mutate({ workspace_id: workspaceId, persona_id: personaId, name: label, steps: defaultCampaignSteps() });
  };

  if (isLoading) {
    return (
      <div className="flex h-56 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--a1))]" />
      </div>
    );
  }

  if (selected) {
    return (
      <CampaignDetail
        campaign={selected}
        onBack={() => setSelectedId(null)}
        activePersonas={activePersonas}
        campaignByPersona={campaignByPersona}
        workspaceId={workspaceId ?? null}
      />
    );
  }

  const total = (campaigns ?? []).length;
  const activeCount = (campaigns ?? []).filter((c) => c.is_active).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground title-glow">Campagnes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Gère tes campagnes d'outreach automatisées</p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="glass inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4 text-[hsl(var(--a1))]" />
            <span className="font-semibold tabular-nums text-foreground">{activeCount}</span> / {total} actives
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="gap-1.5" disabled={personasSansCampagne.length === 0 || upsert.isPending}>
                <Plus className="h-4 w-4" /> Nouvelle campagne
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="glass-strong">
              {personasSansCampagne.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => createFor(p.id, p.label)}>
                  <Users className="mr-2 h-3.5 w-3.5 text-[hsl(var(--a1))]" /> {p.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {total === 0 ? (
        <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
          {personasSansCampagne.length === 0
            ? "Aucun persona actif. Crée un persona dans l'onglet « Personas » pour lancer une campagne."
            : 'Aucune campagne. Clique « Nouvelle campagne » pour en créer une à partir d’un ICP.'}
        </div>
      ) : (
        <motion.div {...staggerProps} className="grid gap-5 lg:grid-cols-2">
          {(campaigns ?? []).map((c) => (
            <CampaignCard key={c.id} campaign={c} workspaceId={workspaceId ?? null} onOpen={() => setSelectedId(c.id)} />
          ))}
        </motion.div>
      )}

      <div className="mt-8 border-t border-border/50 pt-6">
        <ProspectionCampaigns />
      </div>
    </div>
  );
}

/* ─────────────── Carte campagne (style "agent") ─────────────── */
function CampaignCard({ campaign, workspaceId, onOpen }: { campaign: Campaign; workspaceId: string | null; onOpen: () => void }) {
  const upsert = useUpsertCampaign();
  const { data: mappings } = useSmartleadCampaignMappings();
  const mapping = mappings?.find((m) => m.persona_id === campaign.persona_id);
  const { data: stats } = useSmartleadCampaignStats(mapping?.campaign_id ?? null);
  const a = stats?.ok ? stats.analytics : null;

  const stepChannels = Array.from(new Set(campaign.steps.filter((s) => s.type === 'step').map((s) => s.channel ?? 'email')));

  const toggleActive = () => {
    if (!workspaceId) return;
    upsert.mutate({
      id: campaign.id,
      workspace_id: workspaceId,
      persona_id: campaign.persona_id,
      name: campaign.name,
      steps: campaign.steps,
      is_active: !campaign.is_active,
    });
  };

  const created = new Date(campaign.created_at);
  const createdLabel = Number.isNaN(created.getTime())
    ? ''
    : created.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

  const stat = (value: React.ReactNode, sub: string) => (
    <div className="min-w-0">
      <div className="text-[26px] font-bold leading-none tabular-nums text-foreground">{value}</div>
      <div className="mt-1.5 truncate text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );

  return (
    <motion.div variants={glassPop} className="glass flex flex-col rounded-2xl p-5 transition-transform duration-300 hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-foreground">{campaign.name}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{campaign.persona?.label ?? 'ICP'}</p>
        </div>
        <button
          onClick={toggleActive}
          disabled={upsert.isPending}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
            campaign.is_active ? 'bg-emerald-400/15 text-emerald-500' : 'bg-amber-400/15 text-amber-500',
          )}
          title="Activer / mettre en pause"
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', campaign.is_active ? 'bg-emerald-500' : 'bg-amber-500')} />
          {campaign.is_active ? 'Active' : 'En pause'}
        </button>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-3">
        {stat(a ? <AnimatedNumber value={a.sent} /> : '—', 'contactés')}
        {stat(a && a.open_rate !== null ? <AnimatedNumber value={a.open_rate} format={(n) => `${n.toFixed(0)} %`} /> : '—', 'ouverture')}
        {stat(a ? <AnimatedNumber value={a.replied} /> : '—', 'réponses')}
        {stat(a && a.reply_rate !== null ? <AnimatedNumber value={a.reply_rate} format={(n) => `${n.toFixed(1)} %`} /> : '—', 'reply rate')}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border/40 pt-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1">
            {stepChannels.includes('email') && <Mail className="h-3.5 w-3.5 text-[hsl(var(--a1))]" />}
            {stepChannels.includes('linkedin') && <Linkedin className="h-3.5 w-3.5 text-[hsl(var(--a2))]" />}
            {stepChannels.includes('letter') && <PenLine className="h-3.5 w-3.5 text-[#F0997B]" />}
          </div>
          {createdLabel && <span className="text-[11px] text-muted-foreground/70">Créée le {createdLabel}</span>}
        </div>
        <Button size="sm" className="gap-1.5" onClick={onOpen}>
          Ouvrir <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}

/* ─────────────── Détail : chaque étape éditable individuellement ─────────────── */
function CampaignDetail({
  campaign,
  onBack,
  activePersonas,
  campaignByPersona,
  workspaceId,
}: {
  campaign: Campaign;
  onBack: () => void;
  activePersonas: { id: string; label: string }[];
  campaignByPersona: Map<string, Campaign>;
  workspaceId: string | null;
}) {
  const upsert = useUpsertCampaign();
  const { data: mappings } = useSmartleadCampaignMappings();
  const mapping = mappings?.find((m) => m.persona_id === campaign.persona_id);
  const { data: stats, isFetching } = useSmartleadCampaignStats(mapping?.campaign_id ?? null);
  const analytics = stats?.ok ? stats.analytics : null;

  const [steps, setSteps] = useState<CampaignStep[]>(campaign.steps);
  const [nameDraft, setNameDraft] = useState(campaign.name);
  const [editing, setEditing] = useState<CampaignStep | null>(null); // étape en cours d'édition (pop-up)

  useEffect(() => setSteps(campaign.steps), [campaign.steps]);
  useEffect(() => setNameDraft(campaign.name), [campaign.name]);

  // Persiste la campagne (steps + éventuellement name/persona)
  const persist = (nextSteps: CampaignStep[], over?: { name?: string; personaId?: string }) => {
    if (!workspaceId) return;
    setSteps(nextSteps);
    upsert.mutate({
      id: campaign.id,
      workspace_id: workspaceId,
      persona_id: over?.personaId ?? campaign.persona_id,
      name: over?.name ?? campaign.name,
      steps: nextSteps,
    });
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const copy = [...steps];
    const a = copy[i];
    const b = copy[j];
    if (!a || !b) return;
    copy[i] = b;
    copy[j] = a;
    persist(copy);
  };
  const removeNode = (id: string) => persist(steps.filter((n) => n.id !== id));
  const addStep = () => {
    const node: CampaignStep = { id: uid(), type: 'step', channel: 'email', title: 'Nouvel email', subject: '', body: '' };
    persist([...steps, node]);
    setEditing(node);
  };
  const addWait = () => persist([...steps, { id: uid(), type: 'wait', delay_days: 2 }]);

  const saveEditing = (updated: CampaignStep) => {
    persist(steps.map((n) => (n.id === updated.id ? updated : n)));
    setEditing(null);
  };

  const saveName = () => {
    const v = nameDraft.trim();
    if (v && v !== campaign.name) persist(steps, { name: v });
  };
  const changePersona = (personaId: string) => {
    if (personaId !== campaign.persona_id) persist(steps, { personaId });
  };

  const personaOptions = activePersonas.filter((p) => p.id === campaign.persona_id || !campaignByPersona.has(p.id));

  const headStats = [
    { label: 'Contacts', icon: Users, node: analytics ? <AnimatedNumber value={analytics.sent} /> : '—' },
    { label: 'Ouverture', icon: MailOpen, node: analytics && analytics.open_rate !== null ? <AnimatedNumber value={analytics.open_rate} format={(n) => `${n.toFixed(0)} %`} /> : '—' },
    { label: 'Réponse', icon: MessageSquare, node: analytics && analytics.reply_rate !== null ? <AnimatedNumber value={analytics.reply_rate} format={(n) => `${n.toFixed(0)} %`} /> : '—' },
    { label: 'RDV', icon: CalendarCheck, node: '—' as React.ReactNode },
  ];

  return (
    <div className="space-y-5">
      {/* En-tête détail : nom + ICP éditables inline */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="h-9 w-72 max-w-full border-transparent bg-transparent px-1 text-2xl font-semibold text-foreground focus-visible:border-border"
            />
            <div className="mt-1 flex items-center gap-2 px-1">
              <span className="text-xs text-muted-foreground">ICP :</span>
              <select
                value={campaign.persona_id}
                onChange={(e) => changePersona(e.target.value)}
                className="h-7 rounded-md border border-border bg-foreground/5 px-2 text-xs text-foreground"
              >
                {personaOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {upsert.isPending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
          </div>
        </div>
      </div>

      {/* KPI Smartlead */}
      <motion.div {...staggerProps} className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {headStats.map((k) => {
          const Icon = k.icon;
          return (
            <motion.div key={k.label} variants={glassPop} className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-muted-foreground">{k.label}</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--a1)/0.14)] text-[hsl(var(--a1))]">
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-foreground">{k.node}</div>
            </motion.div>
          );
        })}
      </motion.div>
      <p className="-mt-3 px-1 text-[11px] text-muted-foreground/60">
        {isFetching
          ? 'Chargement des stats Smartlead…'
          : mapping
            ? 'Stats en direct de la campagne Smartlead associée à cet ICP (RDV non exposé par l’API).'
            : 'Aucune campagne Smartlead associée à cet ICP — configure-la dans « Connexion Smartlead » (liste des campagnes).'}
      </p>

      {/* Séquence — chaque étape modifiable individuellement */}
      <h3 className="px-1 text-base font-semibold text-foreground">Séquence multi-envoi</h3>
      <div className="relative pl-11">
        <div className="absolute bottom-2 left-[15px] top-2 w-0.5 bg-[hsl(var(--a1)/0.25)]" aria-hidden />
        {steps.map((node, i) => {
          if (node.type === 'wait') {
            return (
              <div key={node.id} className="group relative mb-3.5 flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
                <span className="absolute -left-[37px] top-1/2 z-10 flex h-[18px] w-[18px] -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background">
                  <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                </span>
                Attendre <span className="font-medium text-foreground">{node.delay_days ?? 0} jour(s)</span>
                {node.note ? ` · ${node.note}` : ''}
                <NodeControls i={i} count={steps.length} onEdit={() => setEditing(node)} onMove={move} onRemove={() => removeNode(node.id)} />
              </div>
            );
          }
          const meta = CHANNEL_META[node.channel ?? 'email'];
          const Icon = meta.icon;
          return (
            <div key={node.id} className="group relative mb-3.5">
              <span className={cn('absolute -left-11 top-3.5 z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-background shadow-sm', meta.ring)}>
                <Icon className={cn('h-4 w-4', meta.color)} />
              </span>
              <div className="glass rounded-2xl p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{node.title || meta.label}</span>
                  <span className="rounded-md bg-foreground/10 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{meta.label}</span>
                  <NodeControls i={i} count={steps.length} onEdit={() => setEditing(node)} onMove={move} onRemove={() => removeNode(node.id)} />
                </div>
                {node.channel === 'email' || !node.channel ? (
                  <div className="mt-2.5 rounded-md border border-border bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">
                    {node.subject ? (
                      <p className="truncate">
                        <span className="font-medium text-foreground/80">Objet :</span> {node.subject}
                      </p>
                    ) : null}
                    {node.body ? <p className="mt-1 line-clamp-2">{node.body}</p> : null}
                    {!node.subject && !node.body ? <span className="italic">Email vide — clique ✏️ pour rédiger.</span> : null}
                  </div>
                ) : node.note ? (
                  <div className="mt-2.5 rounded-md border border-border bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">{node.note}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 pl-11">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={addStep} disabled={upsert.isPending}>
          <Plus className="h-3.5 w-3.5" /> Ajouter une étape
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={addWait} disabled={upsert.isPending}>
          <Clock className="h-3.5 w-3.5" /> Ajouter un délai
        </Button>
      </div>

      {/* Pop-up d'édition d'UNE étape */}
      <StepEditDialog step={editing} onClose={() => setEditing(null)} onSave={saveEditing} pending={upsert.isPending} />
    </div>
  );
}

/* Contrôles par nœud (visibles au survol) : éditer / monter / descendre / supprimer */
function NodeControls({
  i,
  count,
  onEdit,
  onMove,
  onRemove,
}: {
  i: number;
  count: number;
  onEdit: () => void;
  onMove: (i: number, d: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-[hsl(var(--a1))]" onClick={onEdit} title="Modifier">
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" disabled={i === 0} onClick={() => onMove(i, -1)}>
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" disabled={i === count - 1} onClick={() => onMove(i, 1)}>
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-rose-400" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/* Pop-up d'édition d'une seule étape (brouillon local) */
function StepEditDialog({
  step,
  onClose,
  onSave,
  pending,
}: {
  step: CampaignStep | null;
  onClose: () => void;
  onSave: (s: CampaignStep) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState<CampaignStep | null>(step);
  useEffect(() => setDraft(step), [step]);

  if (!draft) return null;
  const set = (p: Partial<CampaignStep>) => setDraft((d) => (d ? { ...d, ...p } : d));

  return (
    <Dialog open={!!step} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-strong max-w-lg">
        <DialogHeader>
          <DialogTitle>{draft.type === 'wait' ? 'Modifier le délai' : "Modifier l'étape"}</DialogTitle>
        </DialogHeader>

        {draft.type === 'wait' ? (
          <div className="space-y-3 py-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Délai (jours)</label>
              <Input type="number" min={0} value={draft.delay_days ?? 0} onChange={(e) => set({ delay_days: Number(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Note (optionnel)</label>
              <Input value={draft.note ?? ''} onChange={(e) => set({ note: e.target.value })} placeholder="ex. si pas de réponse" />
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Canal</label>
                <select
                  value={draft.channel ?? 'email'}
                  onChange={(e) => set({ channel: e.target.value as StepChannel })}
                  className="h-10 w-full rounded-md border border-border bg-foreground/5 px-3 text-sm text-foreground"
                >
                  <option value="email">Email</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="letter">Courrier</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Titre de l'étape</label>
                <Input value={draft.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="ex. Email — icebreaker" />
              </div>
            </div>
            {draft.channel === 'email' || !draft.channel ? (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Objet</label>
                  <Input value={draft.subject ?? ''} onChange={(e) => set({ subject: e.target.value })} placeholder="Variables {{prénom}}, {{entreprise}}…" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Corps du message</label>
                  <Textarea value={draft.body ?? ''} onChange={(e) => set({ body: e.target.value })} rows={5} placeholder="Rédige ton message…" />
                </div>
              </>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Note / consigne</label>
                <Textarea value={draft.note ?? ''} onChange={(e) => set({ note: e.target.value })} rows={4} placeholder="ex. Invitation sans note ; note auto si pas d'email." />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button className="gap-1.5" disabled={pending} onClick={() => onSave(draft)}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
