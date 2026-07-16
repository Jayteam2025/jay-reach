import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Briefcase, ExternalLink, Loader2, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fadeUp, glassPop, staggerProps } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Prospect, useProspects } from '@/hooks/useProspects';
import { useSignaux } from '@/hooks/useSignauxTriage';
import type { ProspectSignal } from '@/hooks/useProspectSignals';
import { AnimatedNumber } from './AnimatedNumber';

const SEQ_META: { kind: SeqKind; label: string; color: string }[] = [
  { kind: 'seq', label: 'En séquence', color: 'hsl(var(--a1))' },
  { kind: 'replied', label: 'Répondu', color: '#34D399' },
  { kind: 'waiting', label: 'À lancer', color: 'hsl(var(--muted-foreground))' },
  { kind: 'bounce', label: 'Bounce', color: '#F87171' },
];

const AVATAR_TINTS = [
  'bg-[hsl(var(--a1)/0.15)] text-[hsl(var(--a1))]',
  'bg-[hsl(var(--a2)/0.15)] text-[hsl(var(--a2))]',
  'bg-emerald-400/15 text-emerald-500',
  'bg-[#F0997B]/15 text-[#F0997B]',
  'bg-rose-400/15 text-rose-400',
];

const BOUNCE = new Set(['invalid', 'disposable', 'bounced']);

function initials(p: Prospect): string {
  return `${(p.first_name?.[0] ?? '').toUpperCase()}${(p.last_name?.[0] ?? '').toUpperCase()}` || '?';
}

function tintFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "à l'instant";
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hier' : `il y a ${d} j`;
}

type SeqKind = 'seq' | 'replied' | 'waiting' | 'bounce';
function sequencePill(p: Prospect): { label: string; kind: SeqKind } {
  if (p.deliverability_status && BOUNCE.has(p.deliverability_status)) return { label: 'Bounce', kind: 'bounce' };
  if (p.status === 'meeting_booked' || p.status === 'converted') return { label: 'Répondu', kind: 'replied' };
  if (p.smartlead_push_decision === 'push') return { label: 'En séquence', kind: 'seq' };
  return { label: 'À lancer', kind: 'waiting' };
}

const PILL_CLS: Record<SeqKind, string> = {
  seq: 'bg-[hsl(var(--a1)/0.14)] text-[hsl(var(--a1))]',
  replied: 'bg-emerald-400/15 text-emerald-500',
  waiting: 'bg-foreground/10 text-muted-foreground',
  bounce: 'bg-rose-400/15 text-rose-400',
};

export function ProspectionProspects() {
  const { data: prospects, isLoading } = useProspects();
  const { data: signals } = useSignaux();
  const { toast } = useToast();

  const [personaTab, setPersonaTab] = useState<string>('all');
  const [signalFilter, setSignalFilter] = useState<'all' | 'job_posting' | 'linkedin_activity'>('all');
  const [seqFilter, setSeqFilter] = useState<SeqKind | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const signalById = useMemo(() => {
    const m = new Map<string, ProspectSignal>();
    (signals ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [signals]);

  // Onglets ICP pilotés par les personas réellement présents
  const personaTabs = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    (prospects ?? []).forEach((p) => {
      const key = p.persona?.slug ?? 'unknown';
      const label = p.persona?.label ?? 'Sans persona';
      const cur = map.get(key) ?? { label, count: 0 };
      cur.count++;
      map.set(key, cur);
    });
    return Array.from(map.entries()).map(([slug, v]) => ({ slug, ...v }));
  }, [prospects]);

  const seqDist = useMemo(() => {
    const c: Record<SeqKind, number> = { seq: 0, replied: 0, waiting: 0, bounce: 0 };
    (prospects ?? []).forEach((p) => {
      c[sequencePill(p).kind]++;
    });
    return c;
  }, [prospects]);
  const maxSeq = Math.max(1, ...Object.values(seqDist));

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (prospects ?? []).filter((p) => {
      if (personaTab !== 'all' && (p.persona?.slug ?? 'unknown') !== personaTab) return false;
      if (seqFilter !== 'all' && sequencePill(p).kind !== seqFilter) return false;
      const sig = p.source_signal_id ? signalById.get(p.source_signal_id) : undefined;
      if (signalFilter !== 'all' && sig?.signal_type !== signalFilter) return false;
      if (q) {
        const hay = `${p.first_name} ${p.last_name} ${p.company_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [prospects, personaTab, seqFilter, signalFilter, search, signalById]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tabsWithAll = [{ slug: 'all', label: 'Tous', count: prospects?.length ?? 0 }, ...personaTabs];

  return (
    <div className="space-y-4">
      <div className="pt-2">
        <h1 className="text-2xl font-semibold text-foreground title-glow">Prospects</h1>
        <p className="mt-1 text-sm text-muted-foreground">Où en est chaque contact ?</p>
      </div>

      {/* Cartes-stats par ICP (cliquables) */}
      <motion.div {...staggerProps} className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
        {tabsWithAll.map((t) => {
          const active = personaTab === t.slug;
          return (
            <motion.button
              key={t.slug}
              variants={glassPop}
              onClick={() => setPersonaTab(t.slug)}
              className={cn(
                'glass rounded-2xl p-4 text-left transition-transform duration-300 hover:-translate-y-0.5',
                active && 'bg-[hsl(var(--a1)/0.06)] ring-1 ring-[hsl(var(--a1)/0.45)]',
              )}
            >
              <span className={cn('text-[13px] font-medium', active ? 'text-[hsl(var(--a1))]' : 'text-muted-foreground')}>
                {t.label}
              </span>
              <div className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums text-foreground">
                <AnimatedNumber value={t.count} />
              </div>
            </motion.button>
          );
        })}
      </motion.div>

      {/* Filtres + action de masse */}
      <div className="flex flex-wrap items-center justify-end gap-2">
          <select
            value={signalFilter}
            onChange={(e) => setSignalFilter(e.target.value as typeof signalFilter)}
            className="h-9 rounded-md border border-border bg-foreground/5 px-2.5 text-xs text-foreground backdrop-blur-sm"
          >
            <option value="all">Signal : tous</option>
            <option value="job_posting">Offre d’emploi</option>
            <option value="linkedin_activity">Post LinkedIn</option>
          </select>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un nom, une entreprise"
            className="h-9 w-56 text-xs"
          />
          <Button
            size="sm"
            disabled={selected.size === 0}
            onClick={() =>
              toast({
                title: `${selected.size} contact${selected.size > 1 ? 's' : ''} sélectionné${selected.size > 1 ? 's' : ''}`,
                description: 'La mise en séquence s’effectue via l’onglet Campagnes (push Smartlead).',
              })
            }
          >
            Ajouter à une campagne ({selected.size})
          </Button>
        </div>

      {/* Table + panneau Séquence */}
      <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--a1))]" />
        </div>
      ) : rows.length === 0 ? (
        <div className="glass rounded-xl p-10 text-center text-sm text-muted-foreground">Aucun contact.</div>
      ) : (
        <div className="glass overflow-hidden rounded-xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 px-3 py-2.5" />
                  <th className="px-3 py-2.5 font-semibold">Contact</th>
                  <th className="px-3 py-2.5 font-semibold">Signal</th>
                  <th className="px-3 py-2.5 font-semibold">Séquence</th>
                </tr>
              </thead>
              <motion.tbody key={`${personaTab}-${signalFilter}`} {...staggerProps}>
                {rows.map((p) => {
                  const sig = p.source_signal_id ? signalById.get(p.source_signal_id) : undefined;
                  const isJob = sig?.signal_type === 'job_posting';
                  const score = sig ? Number(sig.extracted_data?.ai_score ?? 0) || 0 : 0;
                  const keyword =
                    (sig?.extracted_data?.matched_keyword as string) ||
                    (sig?.extracted_data?.keyword as string) ||
                    undefined;
                  const pill = sequencePill(p);
                  return (
                    <motion.tr key={p.id} variants={fadeUp} className="border-t border-border/40 transition hover:bg-[hsl(var(--a1)/0.04)]">
                      <td className="px-3 py-3 align-middle">
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                          className="h-4 w-4 accent-[hsl(var(--a1))]"
                        />
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                              tintFor(p.persona?.slug ?? p.id),
                            )}
                          >
                            {initials(p)}
                          </span>
                          <div className="min-w-0">
                            {p.linkedin_url ? (
                              <a
                                href={p.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-[hsl(var(--a2))] hover:underline"
                              >
                                {p.first_name} {p.last_name}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="font-medium text-foreground">
                                {p.first_name} {p.last_name}
                              </span>
                            )}
                            <div className="truncate text-xs text-muted-foreground">
                              {[p.job_title, p.company_name].filter(Boolean).join(' · ') || '—'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-middle">
                        {sig ? (
                          <>
                            <div className="flex items-center gap-1.5">
                              {isJob ? (
                                <Briefcase className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <MessageCircle className="h-3.5 w-3.5 text-[hsl(var(--a2))]" />
                              )}
                              <span className="truncate">
                                {isJob ? 'Offre' : 'Post LinkedIn'}
                                {sig.company_name ? ` : ${sig.company_name}` : ''}
                              </span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                              {[keyword ? `« ${keyword} »` : null, score ? `score ${score}` : null, relativeTime(sig.detected_at)]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <span className={cn('inline-block rounded-full px-2.5 py-1 text-[11px] font-medium', PILL_CLS[pill.kind])}>
                          {pill.label}
                        </span>
                      </td>
                    </motion.tr>
                  );
                })}
              </motion.tbody>
            </table>
          </div>
        </div>
      )}
      </div>

      {/* Panneau Séquence */}
      <motion.div initial="hidden" animate="show" variants={fadeUp} className="glass h-fit rounded-2xl p-5">
        <h2 className="mb-4 text-base font-semibold text-foreground">Séquence</h2>
        <div className="space-y-3.5">
          {SEQ_META.map((s) => {
            const active = seqFilter === s.kind;
            const count = seqDist[s.kind];
            return (
              <button key={s.kind} onClick={() => setSeqFilter(active ? 'all' : s.kind)} className="w-full text-left">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/10">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${(count / maxSeq) * 100}%`, background: s.color, opacity: active ? 1 : 0.7 }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </motion.div>
      </div>

      <p className="px-1 text-xs text-muted-foreground/70">
        La progression fine de séquence (ex. « Email 2/5 ») n’est pas encore suivie côté base — la pastille reflète
        l’état dérivé (bounce, en séquence, répondu, à lancer). Clique un état pour filtrer · nom cliquable → profil LinkedIn.
      </p>
    </div>
  );
}
