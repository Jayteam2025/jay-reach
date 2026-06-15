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
import { Loader2, FileText, Mail, Linkedin, Send } from 'lucide-react';
import {
  useProspectMessageTemplates,
  useUpdateProspectMessageTemplate,
  useCountNonSentMessages,
  templateKey,
  type ProspectMessageTemplate,
  type ProspectTargetCategory,
  type ProspectChannel,
} from '@/hooks/useProspectMessageTemplates';
import { useIcpPersonas } from '@/hooks/useIcpPersonas';
import {
  TemplateEditor,
  deepEqualDraft,
  templateToDraft,
  type TemplateDraft,
} from './TemplateEditor';

// Mapping legacy persona slug -> target_category (1.2.3.e : V1 transition)
const PERSONA_SLUG_TO_TARGET_CATEGORY: Record<string, ProspectTargetCategory> = {
  'hr-decision-maker': 'hr',
  'director': 'director',
  'field-sales': 'field_sales',
};

// Labels fallback si pas de persona resolu (rows pre-migration ou hooks pas ready)
const LEGACY_CATEGORY_LABELS: Record<ProspectTargetCategory, string> = {
  hr: 'RH',
  director: 'Directeur commercial',
  field_sales: 'Commercial terrain',
};

const CHANNELS_BY_CATEGORY: Record<ProspectTargetCategory, ProspectChannel[]> = {
  hr: ['email', 'linkedin'],
  director: ['email', 'linkedin', 'postal_letter'],
  field_sales: ['email', 'linkedin'],
};

const CHANNEL_META: Record<
  ProspectChannel,
  { label: string; icon: typeof Mail }
> = {
  email: { label: 'Email', icon: Mail },
  linkedin: { label: 'LinkedIn', icon: Linkedin },
  postal_letter: { label: 'Lettre postale', icon: Send },
  social_dm: { label: 'Social DM', icon: Send },
};

export function ProspectionConfig() {
  const { data: templates, isLoading } = useProspectMessageTemplates();
  const { data: personas } = useIcpPersonas();
  const [category, setCategory] = useState<ProspectTargetCategory>('hr');
  const channels = CHANNELS_BY_CATEGORY[category];
  const [channel, setChannel] = useState<ProspectChannel>(channels[0] ?? 'email');

  // Categories dynamiques derivees des personas actifs du workspace. Label vient
  // de persona.label, value est le target_category legacy mappe (transition V1).
  // Personas sans mapping legacy sont masques. Fallback aux 3 categories legacy
  // si personas pas encore charges.
  const CATEGORIES = useMemo(() => {
    if (!personas || personas.length === 0) {
      return (
        Object.entries(LEGACY_CATEGORY_LABELS) as Array<[ProspectTargetCategory, string]>
      ).map(([value, label]) => ({ value, label }));
    }
    return personas
      .filter((p) => p.is_active)
      .map((p) => {
        const value = PERSONA_SLUG_TO_TARGET_CATEGORY[p.slug];
        if (!value) return null;
        return { value, label: p.label };
      })
      .filter((c): c is { value: ProspectTargetCategory; label: string } => c !== null);
  }, [personas]);

  // Reset channel quand on change de catégorie (si le canal actif n'existe plus)
  useEffect(() => {
    if (!CHANNELS_BY_CATEGORY[category].includes(channel)) {
      const firstChannel = CHANNELS_BY_CATEGORY[category][0];
      if (firstChannel) {
        setChannel(firstChannel);
      }
    }
  }, [category, channel]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">
          Templates de messages
        </h2>
        <p className="text-muted-foreground mt-1">
          Templates de messages par catégorie cible. Les modifications régénèrent
          tous les messages non envoyés.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : !templates || templates.size === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <FileText className="size-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground">
            Aucun template trouvé. Vérifiez que la migration seed a bien été
            appliquée.
          </p>
        </div>
      ) : (
        <Tabs
          value={category}
          onValueChange={(v) => setCategory(v as ProspectTargetCategory)}
          className="space-y-4"
        >
          <TabsList className="bg-transparent border-b border-border rounded-none w-full justify-start h-auto p-0 gap-1">
            {CATEGORIES.map((c) => (
              <TabsTrigger
                key={c.value}
                value={c.value}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-violet-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 text-sm text-muted-foreground data-[state=active]:text-foreground"
              >
                {c.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {CATEGORIES.map((c) => (
            <TabsContent key={c.value} value={c.value} className="space-y-4 mt-0">
              <CategoryPanel
                category={c.value}
                templates={templates}
                channel={channel}
                onChannelChange={setChannel}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

interface CategoryPanelProps {
  category: ProspectTargetCategory;
  templates: Map<string, ProspectMessageTemplate>;
  channel: ProspectChannel;
  onChannelChange: (next: ProspectChannel) => void;
}

function CategoryPanel({
  category,
  templates,
  channel,
  onChannelChange,
}: CategoryPanelProps) {
  const channels = CHANNELS_BY_CATEGORY[category];
  const activeChannel = channels.includes(channel) ? channel : (channels[0] ?? 'email');
  const template = templates.get(templateKey(category, activeChannel));

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border">
        {channels.map((ch) => {
          const meta = CHANNEL_META[ch];
          const Icon = meta.icon;
          const isActive = activeChannel === ch;
          return (
            <button
              key={ch}
              type="button"
              onClick={() => onChannelChange(ch)}
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

      {template ? (
        <TemplatePanel template={template} />
      ) : (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-muted-foreground">
          Template manquant pour {category}:{activeChannel}.
        </div>
      )}
    </div>
  );
}

function TemplatePanel({ template }: { template: ProspectMessageTemplate }) {
  const [draft, setDraft] = useState<TemplateDraft>(() => templateToDraft(template));
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Re-sync quand on change de template_id (changement de tab) ou quand la
  // version DB change (= save reussi). Pas sur chaque ref change du template
  // (sinon un refetch silencieux ecrase les modifications en cours).
  useEffect(() => {
    setDraft(templateToDraft(template));
  }, [template.id, template.version]);

  const isDirty = useMemo(
    () => !deepEqualDraft(draft, templateToDraft(template)),
    [draft, template],
  );

  function reset() {
    setDraft(templateToDraft(template));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {!template.is_active ? (
            <Badge variant="secondary" className="text-xs">
              Inactif
            </Badge>
          ) : null}
          {isDirty ? (
            <Badge className="bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/20 hover:bg-violet-500/10 text-xs">
              Modifications non enregistrées
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={!isDirty}
          >
            Annuler
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={!isDirty}
          >
            Sauvegarder & Appliquer
          </Button>
        </div>
      </div>

      <TemplateEditor template={template} draft={draft} onDraftChange={setDraft} />

      <RegenerateConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        template={template}
        draft={draft}
      />
    </div>
  );
}

interface RegenerateConfirmDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  template: ProspectMessageTemplate;
  draft: TemplateDraft;
}

function RegenerateConfirmDialog({
  open,
  onOpenChange,
  template,
  draft,
}: RegenerateConfirmDialogProps) {
  const { toast } = useToast();
  const { data: count, isLoading: countLoading } = useCountNonSentMessages(
    template.persona_id,
    template.channel,
    open,
  );
  const { data: personas } = useIcpPersonas();
  const mutation = useUpdateProspectMessageTemplate();

  // Resout le label de la categorie via persona.label (fallback legacy).
  const categoryLabel = useMemo(() => {
    if (personas) {
      const persona = personas.find(
        (p) => PERSONA_SLUG_TO_TARGET_CATEGORY[p.slug] === template.target_category,
      );
      if (persona) return persona.label;
    }
    return LEGACY_CATEGORY_LABELS[template.target_category];
  }, [personas, template.target_category]);

  async function handleConfirm() {
    try {
      const result = await mutation.mutateAsync({
        id: template.id,
        subject: draft.subject,
        body: draft.body,
        icebreaker_template: draft.icebreaker_template,
      });

      toast({
        description: `Template sauvegardé. ${result.regenerated_count} message${result.regenerated_count > 1 ? 's' : ''} régénéré${result.regenerated_count > 1 ? 's' : ''}.`,
      });
      onOpenChange(false);
    } catch (err) {
      logger.error('Update template error', err);
      toast({
        description: `Erreur : ${(err as Error).message}`,
        variant: 'destructive',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Régénérer les messages non envoyés ?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground pt-2">
            {countLoading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-3 animate-spin" />
                Calcul du nombre de messages…
              </span>
            ) : count === 0 ? (
              <>
                Aucun message non envoyé pour ce template. Le template sera quand
                même sauvegardé pour les futurs envois.
              </>
            ) : (
              <>
                Cette modification va régénérer{' '}
                <span className="font-semibold text-foreground">
                  {count} message{count && count > 1 ? 's' : ''}
                </span>{' '}
                {CHANNEL_META[template.channel].label.toLowerCase()} pour la
                catégorie{' '}
                <span className="font-medium text-foreground">
                  {categoryLabel}
                </span>{' '}
                qui n'ont pas encore été envoyés.
              </>
            )}
            <br />
            <span className="text-xs">
              Les messages déjà envoyés (status sent / replied / bounced) ne
              seront pas touchés.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Annuler
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={mutation.isPending}
            className="gap-2"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Régénération…
              </>
            ) : (
              'Sauvegarder & régénérer'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
