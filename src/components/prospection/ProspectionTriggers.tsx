import { useState } from 'react';
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
import { Plus, Edit2, Trash2, Loader2 } from 'lucide-react';
import {
  useSignalTriggers,
  useUpsertSignalTrigger,
  useDeleteSignalTrigger,
  KNOWN_SOURCE_TYPES,
  type SignalTrigger,
  type SignalTriggerDraft,
} from '@/hooks/useSignalTriggers';
import { useCurrentWorkspaceId } from '@/hooks/useCurrentWorkspaceId';

// Slug stable dérivé du label (généré à la création, jamais modifié ensuite). Pas
// de champ manuel.
function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Libellés lisibles des sources (sinon on affiche la clé brute type "apify_linkedin").
const SOURCE_LABELS: Record<string, string> = {
  adzuna: 'Adzuna',
  france_travail: 'France Travail',
  apify_linkedin: 'Apify (LinkedIn Jobs)',
};

const DEFAULT_DRAFT: SignalTriggerDraft = {
  slug: '',
  label: '',
  description: '',
  icon: null,
  search_keywords: [],
  exclude_keywords: [],
  source_types: ['adzuna', 'france_travail'],
  industry_filters: [],
  geo_filters: [],
  signal_scoring_prompt:
    'Decris ici quel type d\'entreprise tu cherches a detecter et pourquoi. Plus tu es precis, mieux les annonces seront filtrees.\n\nExemple :\n"Entreprises en pleine croissance qui recrutent activement. Doit etre une vraie entreprise (pas un cabinet de recrutement, pas une mission freelance)."',
  signal_match_threshold: 60,
  elimination_rules: [],
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

export function ProspectionTriggers() {
  const { toast } = useToast();
  const { data: triggers, isLoading } = useSignalTriggers();
  const upsert = useUpsertSignalTrigger();
  const remove = useDeleteSignalTrigger();
  const { data: workspaceId } = useCurrentWorkspaceId();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SignalTriggerDraft>(DEFAULT_DRAFT);

  const openCreate = () => {
    setDraft({ ...DEFAULT_DRAFT });
    setOpen(true);
  };

  const openEdit = (trigger: SignalTrigger) => {
    setDraft({
      id: trigger.id,
      slug: trigger.slug,
      label: trigger.label,
      description: trigger.description ?? '',
      icon: trigger.icon,
      search_keywords: trigger.search_keywords,
      exclude_keywords: trigger.exclude_keywords,
      source_types: trigger.source_types,
      industry_filters: trigger.industry_filters,
      geo_filters: trigger.geo_filters,
      signal_scoring_prompt: trigger.signal_scoring_prompt,
      signal_match_threshold: trigger.signal_match_threshold,
      elimination_rules: trigger.elimination_rules,
      is_active: trigger.is_active,
      is_default: trigger.is_default,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!draft.label || draft.signal_scoring_prompt.length < 50) {
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
      toast({ title: draft.id ? 'Declencheur mis a jour' : 'Declencheur cree' });
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
      toast({ title: 'Declencheur supprime' });
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
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold text-foreground title-glow">Déclencheurs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Comment détecter les entreprises à contacter. Définis les signaux qui révèlent une opportunité
            (recrutements, levées de fonds, ouvertures…) et l'outil scrape automatiquement les annonces correspondantes.
          </p>
        </div>
        <Button onClick={openCreate} className="shrink-0 gap-2">
          <Plus className="h-4 w-4" /> Nouveau déclencheur
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : !triggers || triggers.length === 0 ? (
        <div className="glass text-center py-12 rounded-lg text-gray-500 dark:text-white/60">
          Aucun declencheur defini. Cree-en un pour commencer a detecter des boites.
        </div>
      ) : (
        <div className="grid gap-3">
          {triggers.map((t) => (
            <div
              key={t.id}
              className="glass rounded-lg p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      {t.label}
                    </h3>
                    <Badge variant="outline" className="text-xs">
                      {t.slug}
                    </Badge>
                    {!t.is_active && (
                      <Badge variant="outline" className="text-xs text-gray-500">
                        Inactif
                      </Badge>
                    )}
                  </div>
                  {t.description && (
                    <p className="text-sm text-gray-500 dark:text-white/60 mt-1">
                      {t.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.source_types.map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  {t.search_keywords.length > 0 && (
                    <p className="text-xs text-gray-400 mt-2 truncate">
                      Mots-cles : {t.search_keywords.slice(0, 5).join(', ')}
                      {t.search_keywords.length > 5 ? '...' : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Supprimer ce declencheur ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Cette action est irreversible. Les signaux deja captures par ce declencheur
                          gardent leur historique mais aucun nouveau signal ne sera scrape.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(t.id)}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Supprimer
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{draft.id ? 'Editer le declencheur' : 'Nouveau declencheur'}</SheetTitle>
            <SheetDescription>
              Comment trouver des boites interessantes : mots-cles a scraper, filtres entreprise, qualification du signal.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 py-6">
            <div>
              <Label htmlFor="t-label">Nom du déclencheur</Label>
              <Input
                id="t-label"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="ex : Boîte qui recrute des commerciaux"
              />
              {draft.id ? (
                <p className="text-xs text-muted-foreground mt-1">
                  Identifiant : <span className="font-mono">{draft.slug}</span>
                </p>
              ) : null}
            </div>

            <div>
              <Label htmlFor="t-desc">Description</Label>
              <Textarea
                id="t-desc"
                value={draft.description ?? ''}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Quel type de boite ce declencheur va-t-il detecter ?"
                rows={2}
              />
            </div>

            <div>
              <Label htmlFor="t-keywords">Mots-cles a chercher (separes par virgule)</Label>
              <Textarea
                id="t-keywords"
                value={arrayToCommaList(draft.search_keywords)}
                onChange={(e) =>
                  setDraft({ ...draft, search_keywords: commaListToArray(e.target.value) })
                }
                placeholder="commercial, vendeur, sales, business developer, ..."
                rows={2}
              />
            </div>

            <div>
              <Label htmlFor="t-excludes">Mots-cles a exclure (separes par virgule)</Label>
              <Textarea
                id="t-excludes"
                value={arrayToCommaList(draft.exclude_keywords)}
                onChange={(e) =>
                  setDraft({ ...draft, exclude_keywords: commaListToArray(e.target.value) })
                }
                placeholder="cabinet, recrutement, freelance, stage, ..."
                rows={2}
              />
            </div>

            <div>
              <Label>Sources actives</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {KNOWN_SOURCE_TYPES.map((source) => {
                  const active = draft.source_types.includes(source);
                  return (
                    <button
                      key={source}
                      type="button"
                      onClick={() => {
                        if (active) {
                          setDraft({
                            ...draft,
                            source_types: draft.source_types.filter((s) => s !== source),
                          });
                        } else {
                          setDraft({
                            ...draft,
                            source_types: [...draft.source_types, source],
                          });
                        }
                      }}
                      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                        active
                          ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                          : 'border-border text-gray-500 hover:border-border'
                      }`}
                    >
                      {SOURCE_LABELS[source] ?? source}
                    </button>
                  );
                })}
              </div>
            </div>


            <div>
              <Label htmlFor="t-industries">Secteurs cibles (separes par virgule)</Label>
              <Input
                id="t-industries"
                value={arrayToCommaList(draft.industry_filters)}
                onChange={(e) =>
                  setDraft({ ...draft, industry_filters: commaListToArray(e.target.value) })
                }
                placeholder="Distribution, BTP, IT services, ..."
              />
            </div>

            <div>
              <Label htmlFor="t-prompt">Description detaillee de ce que tu cherches (min 50 caracteres)</Label>
              <Textarea
                id="t-prompt"
                value={draft.signal_scoring_prompt}
                onChange={(e) => setDraft({ ...draft, signal_scoring_prompt: e.target.value })}
                rows={8}
              />
              <p className="text-xs text-gray-500 mt-1">
                {draft.signal_scoring_prompt.length} caracteres. Cette description est utilisee par l'IA pour ne garder que les annonces vraiment pertinentes. Plus elle est precise, moins tu auras de faux positifs.
              </p>
            </div>

            <div>
              <Label htmlFor="t-threshold">Score minimum de qualification (0-100)</Label>
              <p className="text-xs text-muted-foreground mt-1 mb-2">
                L'IA note chaque offre scrappée de 0 à 100. En dessous de ce score,
                l'entreprise est écartée (non enrichie). 60 = bon compromis.
              </p>
              <Input
                id="t-threshold"
                type="number"
                min={0}
                max={100}
                value={draft.signal_match_threshold}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    signal_match_threshold: Number(e.target.value),
                  })
                }
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={draft.is_active}
                onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
                id="t-active"
              />
              <Label htmlFor="t-active">Declencheur actif</Label>
            </div>
          </div>

          <SheetFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={upsert.isPending}>
              {upsert.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {draft.id ? 'Mettre a jour' : 'Creer'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
