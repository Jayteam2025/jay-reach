import { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { glassPop, staggerProps } from '@/lib/motion';
import { AnimatedNumber } from './AnimatedNumber';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit2, Trash2, Loader2, Users } from 'lucide-react';
import {
  useIcpPersonas,
  useUpsertIcpPersona,
  useDeleteIcpPersona,
  KNOWN_CHANNELS,
  KNOWN_SENIORITY_LEVELS,
  type IcpPersona,
  type IcpPersonaDraft,
} from '@/hooks/useIcpPersonas';
import { useCurrentWorkspaceId } from '@/hooks/useCurrentWorkspaceId';

// Slug stable dérivé du label (généré à la création, jamais modifié ensuite pour ne
// pas casser les références templates / messages). Pas de champ manuel.
function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const DEFAULT_DRAFT: IcpPersonaDraft = {
  slug: '',
  label: '',
  description: '',
  icon: null,
  job_title_keywords: [],
  seniority_levels: [],
  department_patterns: [],
  exclude_titles: [],
  persona_scoring_prompt:
    'Decris ici qui est ce persona en quelques phrases : son role, ses responsabilites, ce qui le rend pertinent pour ton offre. Plus tu es precis, mieux les contacts seront filtres.\n\nExemple :\n"Personne qui valide les budgets logiciels dans son entreprise. Generalement Directeur des Achats, DSI ou DAF. Pas un assistant ni un freelance."',
  persona_match_threshold: 60,
  channels_priority: ['email'],
  channels_config: {},
  is_active: true,
  is_default: false,
};

function commaListToArray(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function arrayToCommaList(arr: string[]): string {
  return arr.join(', ');
}

export function ProspectionPersonas() {
  const { toast } = useToast();
  const { data: personas, isLoading } = useIcpPersonas();
  const upsert = useUpsertIcpPersona();
  const remove = useDeleteIcpPersona();
  const { data: workspaceId } = useCurrentWorkspaceId();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<IcpPersonaDraft>(DEFAULT_DRAFT);

  const openCreate = () => {
    setDraft({ ...DEFAULT_DRAFT });
    setOpen(true);
  };

  const openEdit = (persona: IcpPersona) => {
    setDraft({
      id: persona.id,
      slug: persona.slug,
      label: persona.label,
      description: persona.description ?? '',
      icon: persona.icon,
      job_title_keywords: persona.job_title_keywords,
      seniority_levels: persona.seniority_levels,
      department_patterns: persona.department_patterns,
      exclude_titles: persona.exclude_titles,
      persona_scoring_prompt: persona.persona_scoring_prompt,
      persona_match_threshold: persona.persona_match_threshold,
      channels_priority: persona.channels_priority,
      channels_config: persona.channels_config,
      is_active: persona.is_active,
      is_default: persona.is_default,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!draft.label || draft.persona_scoring_prompt.length < 50) {
      toast({
        variant: 'destructive',
        title: 'Champs manquants',
        description: 'Un nom et un prompt scoring d\'au moins 50 caractères sont requis.',
      });
      return;
    }
    if (!workspaceId) {
      toast({
        variant: 'destructive',
        title: 'Workspace introuvable',
        description: 'Impossible de résoudre votre workspace.',
      });
      return;
    }

    // Slug généré du nom à la création ; conservé tel quel en édition (ID stable).
    const slug = draft.id ? draft.slug : slugify(draft.label);

    try {
      await upsert.mutateAsync({
        ...draft,
        slug,
        workspace_id: workspaceId,
      });
      toast({ title: draft.id ? 'Persona mis a jour' : 'Persona cree' });
      setOpen(false);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      toast({ title: 'Persona supprime' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erreur suppression',
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground title-glow">Personas</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Qui contacter dans les entreprises détectées par tes déclencheurs. Définis plusieurs personas (décideur,
            utilisateur final, prescripteur) pour couvrir tous les contacts d'une même entreprise.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Nouveau persona
        </Button>
      </div>

      {!isLoading && personas && personas.length > 0 && (
        <motion.div {...staggerProps} className="grid grid-cols-2 gap-4 sm:max-w-sm">
          <motion.div variants={glassPop} className="glass rounded-2xl p-4">
            <p className="text-[13px] font-medium text-muted-foreground">Personas</p>
            <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums text-foreground">
              <AnimatedNumber value={personas.length} />
            </p>
          </motion.div>
          <motion.div variants={glassPop} className="glass rounded-2xl p-4">
            <p className="text-[13px] font-medium text-muted-foreground">Actifs</p>
            <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums text-foreground">
              <AnimatedNumber value={personas.filter((p) => p.is_active).length} />
            </p>
          </motion.div>
        </motion.div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--a1))]" />
        </div>
      ) : !personas || personas.length === 0 ? (
        <div className="glass rounded-2xl py-12 text-center text-sm text-muted-foreground">
          Aucun persona défini. Crée-en un pour démarrer.
        </div>
      ) : (
        <motion.div {...staggerProps} className="grid gap-4">
          {personas.map((p) => (
            <motion.div
              key={p.id}
              variants={glassPop}
              className={cn(
                'glass rounded-2xl p-5 transition-transform duration-300 hover:-translate-y-0.5',
                !p.is_active && 'opacity-70',
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 gap-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--a1)/0.14)] text-[hsl(var(--a1))]">
                    <Users className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-foreground">{p.label}</h3>
                      <Badge variant="outline" className="text-[10px] font-mono">{p.slug}</Badge>
                      {!p.is_active && <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactif</Badge>}
                    </div>
                    {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {p.channels_priority.map((c) => (
                        <span key={c} className="rounded-full bg-[hsl(var(--a1)/0.12)] px-2.5 py-0.5 text-[11px] font-medium text-[hsl(var(--a1))]">
                          {c}
                        </span>
                      ))}
                      {p.seniority_levels.map((s) => (
                        <span key={s} className="rounded-full bg-foreground/8 px-2.5 py-0.5 text-[11px] text-muted-foreground">
                          {s}
                        </span>
                      ))}
                    </div>
                    {p.job_title_keywords.length > 0 && (
                      <p className="mt-2 truncate text-xs text-muted-foreground/70">
                        Titres : {p.job_title_keywords.slice(0, 5).join(', ')}
                        {p.job_title_keywords.length > 5 ? '…' : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-rose-500">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Supprimer ce persona ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Cette action est irréversible. Les contacts déjà liés à ce persona gardent leur historique
                          mais ne pourront plus être re-traités avec ces règles.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void handleDelete(p.id)} className="bg-rose-600 hover:bg-rose-700">
                          Supprimer
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{draft.id ? 'Editer le persona' : 'Nouveau persona'}</SheetTitle>
            <SheetDescription>
              Definis le persona : qui contacter, comment l'identifier, sur quels canaux.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 py-6">
            <div>
              <Label htmlFor="label">Nom du persona</Label>
              <Input
                id="label"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="ex : DRH décideur"
              />
              {draft.id ? (
                <p className="text-xs text-muted-foreground mt-1">
                  Identifiant : <span className="font-mono">{draft.slug}</span>
                </p>
              ) : null}
            </div>

            <div>
              <Label htmlFor="desc">Description</Label>
              <Textarea
                id="desc"
                value={draft.description ?? ''}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="A quoi ressemble ce persona en une phrase"
                rows={2}
              />
            </div>

            <div>
              <Label htmlFor="titles">Mots-cles dans les titres de poste (separes par virgule)</Label>
              <Textarea
                id="titles"
                value={arrayToCommaList(draft.job_title_keywords)}
                onChange={(e) =>
                  setDraft({ ...draft, job_title_keywords: commaListToArray(e.target.value) })
                }
                placeholder="DRH, Responsable RH, Talent Acquisition Manager, ..."
                rows={2}
              />
            </div>

            <div>
              <Label htmlFor="excludes">Titres a exclure (separes par virgule)</Label>
              <Textarea
                id="excludes"
                value={arrayToCommaList(draft.exclude_titles)}
                onChange={(e) =>
                  setDraft({ ...draft, exclude_titles: commaListToArray(e.target.value) })
                }
                placeholder="stagiaire, assistant, ..."
                rows={2}
              />
            </div>

            <div>
              <Label>Niveaux hierarchiques (seniority)</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {KNOWN_SENIORITY_LEVELS.map((seniority) => {
                  const active = draft.seniority_levels.includes(seniority);
                  return (
                    <button
                      key={seniority}
                      type="button"
                      onClick={() => {
                        if (active) {
                          setDraft({
                            ...draft,
                            seniority_levels: draft.seniority_levels.filter((s) => s !== seniority),
                          });
                        } else {
                          setDraft({
                            ...draft,
                            seniority_levels: [...draft.seniority_levels, seniority],
                          });
                        }
                      }}
                      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                        active
                          ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                          : 'border-border text-muted-foreground hover:border-foreground/30'
                      }`}
                    >
                      {seniority}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label htmlFor="depts">Departements ciblees (separes par virgule)</Label>
              <Input
                id="depts"
                value={arrayToCommaList(draft.department_patterns)}
                onChange={(e) =>
                  setDraft({ ...draft, department_patterns: commaListToArray(e.target.value) })
                }
                placeholder="Sales, HR, Engineering, ..."
              />
            </div>

            <div>
              <Label htmlFor="prompt">Description detaillee du persona (min 50 caracteres)</Label>
              <Textarea
                id="prompt"
                value={draft.persona_scoring_prompt}
                onChange={(e) => setDraft({ ...draft, persona_scoring_prompt: e.target.value })}
                rows={8}
              />
              <p className="text-xs text-gray-500 mt-1">
                {draft.persona_scoring_prompt.length} caracteres. Cette description est utilisee par l'IA pour identifier et qualifier les bons contacts. Plus elle est precise, meilleurs sont les resultats.
              </p>
            </div>

            <div>
              <Label>Canaux d'outreach</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {KNOWN_CHANNELS.map((channel) => {
                  const active = draft.channels_priority.includes(channel);
                  return (
                    <button
                      key={channel}
                      type="button"
                      onClick={() => {
                        if (active) {
                          setDraft({
                            ...draft,
                            channels_priority: draft.channels_priority.filter((c) => c !== channel),
                          });
                        } else {
                          setDraft({
                            ...draft,
                            channels_priority: [...draft.channels_priority, channel],
                          });
                        }
                      }}
                      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                        active
                          ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                          : 'border-border text-muted-foreground hover:border-foreground/30'
                      }`}
                    >
                      {channel}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={draft.is_active}
                onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
                id="active"
              />
              <Label htmlFor="active">Persona actif</Label>
            </div>
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button onClick={() => void handleSave()} disabled={upsert.isPending}>
              {upsert.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {draft.id ? 'Mettre a jour' : 'Creer'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
