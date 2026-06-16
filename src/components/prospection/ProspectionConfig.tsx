import { useEffect, useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';
import { Loader2, Mail, Linkedin, Send, Users } from 'lucide-react';
import {
  useProspectMessageTemplates,
  useUpsertProspectMessageTemplate,
  useCountNonSentMessages,
  templateKey,
  type ProspectMessageTemplate,
  type ProspectChannel,
} from '@/hooks/useProspectMessageTemplates';
import { useIcpPersonas, type IcpPersona } from '@/hooks/useIcpPersonas';
import {
  TemplateEditor,
  deepEqualDraft,
  templateToDraft,
  type TemplateDraft,
} from './TemplateEditor';

const CHANNEL_META: Record<ProspectChannel, { label: string; icon: typeof Mail }> = {
  email: { label: 'Email', icon: Mail },
  linkedin: { label: 'LinkedIn', icon: Linkedin },
  postal_letter: { label: 'Lettre postale', icon: Send },
  social_dm: { label: 'Social DM', icon: Send },
};

const KNOWN_CHANNELS: ProspectChannel[] = ['email', 'linkedin', 'postal_letter', 'social_dm'];

const EMPTY_DRAFT: TemplateDraft = { subject: '', body: '', icebreaker_template: '' };

// Canaux d'un persona = sa channels_priority filtrée aux canaux connus, fallback
// email + linkedin si le persona n'en déclare aucun.
function personaChannels(persona: IcpPersona): ProspectChannel[] {
  const filtered = (persona.channels_priority ?? []).filter(
    (c): c is ProspectChannel => (KNOWN_CHANNELS as string[]).includes(c),
  );
  return filtered.length ? filtered : ['email', 'linkedin'];
}

export function ProspectionConfig() {
  const { data: templates, isLoading } = useProspectMessageTemplates();
  const { data: personas, isLoading: personasLoading } = useIcpPersonas();

  const activePersonas = useMemo(
    () => (personas ?? []).filter((p) => p.is_active),
    [personas],
  );

  const [personaId, setPersonaId] = useState<string | null>(null);

  // Sélectionne le 1er persona actif par défaut (ou re-sync si la liste change).
  useEffect(() => {
    const first = activePersonas[0];
    if (!first) {
      setPersonaId(null);
    } else if (!personaId || !activePersonas.some((p) => p.id === personaId)) {
      setPersonaId(first.id);
    }
  }, [activePersonas, personaId]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Templates de messages</h2>
        <p className="text-muted-foreground mt-1">
          Un template par persona et par canal. Modifier un template régénère les
          messages non encore envoyés.
        </p>
      </div>

      {isLoading || personasLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : activePersonas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center space-y-2">
          <Users className="size-8 text-muted-foreground mx-auto" />
          <p className="text-foreground font-medium">Aucun persona actif</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Les templates se configurent par persona. Crée d'abord au moins un persona
            dans l'onglet « Personas », puis reviens ici pour rédiger ses messages par
            canal.
          </p>
        </div>
      ) : (
        <Tabs
          value={personaId ?? activePersonas[0]?.id ?? ''}
          onValueChange={setPersonaId}
          className="space-y-4"
        >
          <TabsList className="bg-transparent border-b border-border rounded-none w-full justify-start h-auto p-0 gap-1 flex-wrap">
            {activePersonas.map((p) => (
              <TabsTrigger
                key={p.id}
                value={p.id}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 text-sm text-muted-foreground data-[state=active]:text-foreground"
              >
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {activePersonas.map((p) => (
            <TabsContent key={p.id} value={p.id} className="space-y-4 mt-0">
              <PersonaPanel persona={p} templates={templates ?? new Map()} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function PersonaPanel({
  persona,
  templates,
}: {
  persona: IcpPersona;
  templates: Map<string, ProspectMessageTemplate>;
}) {
  const channels = useMemo(() => personaChannels(persona), [persona]);
  const [channel, setChannel] = useState<ProspectChannel>(channels[0] ?? 'email');

  useEffect(() => {
    if (!channels.includes(channel)) setChannel(channels[0] ?? 'email');
  }, [channels, channel]);

  const template = templates.get(templateKey(persona.id, channel)) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border">
        {channels.map((ch) => {
          const meta = CHANNEL_META[ch];
          const Icon = meta.icon;
          const isActive = channel === ch;
          return (
            <button
              key={ch}
              type="button"
              onClick={() => setChannel(ch)}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-violet-500 text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-3.5" />
              {meta.label}
            </button>
          );
        })}
      </div>

      <TemplateSlot
        key={`${persona.id}:${channel}`}
        persona={persona}
        channel={channel}
        template={template}
      />
    </div>
  );
}

function TemplateSlot({
  persona,
  channel,
  template,
}: {
  persona: IcpPersona;
  channel: ProspectChannel;
  template: ProspectMessageTemplate | null;
}) {
  const baseDraft = template ? templateToDraft(template) : EMPTY_DRAFT;
  const [draft, setDraft] = useState<TemplateDraft>(baseDraft);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Re-sync quand le template (re)charge ou change de version (= save réussi).
  useEffect(() => {
    setDraft(template ? templateToDraft(template) : EMPTY_DRAFT);
  }, [template?.id, template?.version]);

  const isNew = !template;
  const isDirty = useMemo(() => !deepEqualDraft(draft, baseDraft), [draft, baseDraft]);
  const canSave = isDirty && draft.body.trim().length > 0;

  function reset() {
    setDraft(template ? templateToDraft(template) : EMPTY_DRAFT);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {isNew ? (
            <Badge variant="secondary" className="text-xs">Nouveau template</Badge>
          ) : !template.is_active ? (
            <Badge variant="secondary" className="text-xs">Inactif</Badge>
          ) : null}
          {isDirty ? (
            <Badge className="bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/20 hover:bg-violet-500/10 text-xs">
              Modifications non enregistrées
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={!isDirty}>
            Annuler
          </Button>
          <Button type="button" size="sm" onClick={() => setConfirmOpen(true)} disabled={!canSave}>
            {isNew ? 'Créer & Appliquer' : 'Sauvegarder & Appliquer'}
          </Button>
        </div>
      </div>

      <TemplateEditor channel={channel} draft={draft} onDraftChange={setDraft} />

      <RegenerateConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        personaId={persona.id}
        personaLabel={persona.label}
        channel={channel}
        draft={draft}
      />
    </div>
  );
}

function RegenerateConfirmDialog({
  open,
  onOpenChange,
  personaId,
  personaLabel,
  channel,
  draft,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  personaId: string;
  personaLabel: string;
  channel: ProspectChannel;
  draft: TemplateDraft;
}) {
  const { toast } = useToast();
  const { data: count, isLoading: countLoading } = useCountNonSentMessages(
    personaId,
    channel,
    open,
  );
  const mutation = useUpsertProspectMessageTemplate();

  async function handleConfirm() {
    try {
      const result = await mutation.mutateAsync({
        persona_id: personaId,
        channel,
        subject: draft.subject?.trim() ? draft.subject : null,
        body: draft.body,
        icebreaker_template: draft.icebreaker_template,
      });
      toast({
        description: `Template enregistré. ${result.regenerated_count} message${result.regenerated_count > 1 ? 's' : ''} régénéré${result.regenerated_count > 1 ? 's' : ''}.`,
      });
      onOpenChange(false);
    } catch (err) {
      logger.error('Upsert template error', err);
      toast({ description: `Erreur : ${(err as Error).message}`, variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enregistrer le template ?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground pt-2">
            {countLoading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-3 animate-spin" /> Calcul du nombre de messages…
              </span>
            ) : count === 0 ? (
              <>
                Aucun message non envoyé pour ce persona/canal. Le template sera
                enregistré pour les futurs envois.
              </>
            ) : (
              <>
                Cette modification va régénérer{' '}
                <span className="font-semibold text-foreground">
                  {count} message{count && count > 1 ? 's' : ''}
                </span>{' '}
                {CHANNEL_META[channel].label.toLowerCase()} pour le persona{' '}
                <span className="font-medium text-foreground">{personaLabel}</span> qui
                n'ont pas encore été envoyés.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Annuler
          </Button>
          <Button onClick={handleConfirm} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="size-4 mr-1.5 animate-spin" />}
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
