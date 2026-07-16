import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarCheck, Check, Clock, Loader2, Mail, MailOpen, MessageSquare, Linkedin, PenLine, RefreshCw, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { fadeUp, glassPop, staggerProps } from '@/lib/motion';
import { useIcpPersonas } from '@/hooks/useIcpPersonas';
import { useSmartleadCampaignList, useSmartleadCampaignMappings } from '@/hooks/useSmartleadCampaigns';
import { useSmartleadCampaignStats } from '@/hooks/useSmartleadCampaignStats';
import { AnimatedNumber } from './AnimatedNumber';
import { ProspectionCampaigns } from './ProspectionCampaigns';

/**
 * Écran Campagnes (spec §5) : timeline de séquence + stats en direct Smartlead.
 *
 * - Sélecteur de campagne (campagnes Smartlead live).
 * - Stats d'en-tête (contacts / ouverture / réponse) et séquence tirées de
 *   l'API Smartlead via get-smartlead-campaign-stats (auto-refresh 60 s + bouton).
 * - Timeline : vraies étapes Smartlead (email) si disponibles, sinon repli sur la
 *   séquence multicanale canonique du produit. Smartlead ne gère que l'email.
 * - La connexion Smartlead (mapping persona → campagne) reste éditable en bas.
 */

type Channel = 'email' | 'linkedin' | 'letter';

interface Step {
  channel: Channel;
  title: string;
  tag?: string;
  preview: React.ReactNode;
}

const V = ({ children }: { children: string }) => (
  <span className="rounded bg-[hsl(var(--a1)/0.12)] px-1 font-mono text-[11px] text-[hsl(var(--a1))]">{children}</span>
);

// Séquence multicanale canonique (repli quand Smartlead ne renvoie pas d'étapes).
const TEMPLATE: { step?: Step; wait?: string }[] = [
  {
    step: {
      channel: 'email',
      title: 'Étape 1 · Email — icebreaker signal',
      preview: (
        <>
          Objet : Vous recrutez un <V>{'{{intitulé_offre}}'}</V> ? — Bonjour <V>{'{{prénom}}'}</V>, j’ai vu que{' '}
          <V>{'{{entreprise}}'}</V> renforce son équipe terrain…
        </>
      ),
    },
  },
  { wait: '3 jours si pas de réponse' },
  {
    step: {
      channel: 'linkedin',
      title: 'Étape 2 · Invitation LinkedIn',
      preview: 'Sans note — le profil et l’email précédent font le travail. Note ajoutée automatiquement si pas d’email trouvé.',
    },
  },
  { wait: '2 jours après acceptation' },
  {
    step: {
      channel: 'letter',
      title: 'Étape 3 · Courrier manuscrit',
      tag: 'Spécifique dirigeant',
      preview: 'Lettre manuscrite Manuscry — déclenchée uniquement si adresse entreprise vérifiée. Coût : 3,90 € / envoi.',
    },
  },
  { wait: '4 jours' },
  {
    step: {
      channel: 'email',
      title: 'Étape 4 · Email — relance courte',
      preview: (
        <>
          Objet : Re — <V>{'{{prénom}}'}</V>, vous avez peut-être reçu mon mot ? Deux lignes, une question fermée, un
          lien agenda.
        </>
      ),
    },
  },
];

const CHANNEL_META: Record<Channel, { icon: typeof Mail; ring: string; color: string }> = {
  email: { icon: Mail, ring: 'border-[hsl(var(--a1)/0.4)]', color: 'text-[hsl(var(--a1))]' },
  linkedin: { icon: Linkedin, ring: 'border-[hsl(var(--a2)/0.4)]', color: 'text-[hsl(var(--a2))]' },
  letter: { icon: PenLine, ring: 'border-[#F0997B]/40', color: 'text-[#F0997B]' },
};

function prettyStatus(raw: string): string {
  const map: Record<string, string> = {
    ACTIVE: 'Active',
    PAUSED: 'En pause',
    COMPLETED: 'Terminée',
    DRAFTED: 'Brouillon',
    STOPPED: 'Arrêtée',
  };
  return map[raw.toUpperCase()] ?? raw;
}

export function ProspectionCampagnes() {
  const { data: personas } = useIcpPersonas();
  const { data: mappings } = useSmartleadCampaignMappings();
  const { data: listResult } = useSmartleadCampaignList();
  const activePersonas = useMemo(() => (personas ?? []).filter((p) => p.is_active), [personas]);

  const [variant, setVariant] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const currentVariant = variant ?? activePersonas[0]?.slug ?? null;
  const currentPersona = activePersonas.find((p) => p.slug === currentVariant);
  const channelsNote = currentPersona?.channels_priority?.length
    ? currentPersona.channels_priority.join(' + ')
    : 'email + LinkedIn + courrier manuscrit';

  const liveCampaigns = listResult?.ok ? (listResult.campaigns ?? []) : [];
  const mapping = mappings?.find((m) => m.persona_id === currentPersona?.id);

  // Campagne effective : choix explicite > mapping du persona > 1re campagne live
  const effectiveCampaignId =
    picked ?? mapping?.campaign_id ?? (liveCampaigns[0] ? String(liveCampaigns[0].id) : null);

  const { data: stats, isFetching, refetch } = useSmartleadCampaignStats(effectiveCampaignId);
  const analytics = stats?.ok ? stats.analytics : null;

  const selectedLive = liveCampaigns.find((c) => String(c.id) === effectiveCampaignId);
  const campaignName = selectedLive?.name || mapping?.campaign_name || 'Séquence multicanale';
  const statusLabel = selectedLive?.status
    ? prettyStatus(selectedLive.status)
    : !effectiveCampaignId
      ? 'Non connectée'
      : mapping?.enabled
        ? 'Active'
        : 'En pause';
  const isActive = statusLabel === 'Active';
  const statusCls = !effectiveCampaignId
    ? 'bg-foreground/10 text-muted-foreground'
    : isActive
      ? 'bg-emerald-400/15 text-emerald-500'
      : 'bg-amber-400/15 text-amber-500';

  // Timeline : vraies étapes Smartlead si dispo, sinon template canonique
  const realTimeline = useMemo(() => {
    const sequence = stats?.ok ? (stats.sequence ?? []) : [];
    if (!sequence.length) return null;
    const sorted = [...sequence].sort((a, b) => a.seq_number - b.seq_number);
    const items: { step?: Step; wait?: string }[] = [];
    sorted.forEach((s, i) => {
      if (i > 0 && s.delay_days > 0) {
        items.push({ wait: `${s.delay_days} jour${s.delay_days > 1 ? 's' : ''}` });
      }
      items.push({
        step: {
          channel: 'email',
          title: `Étape ${s.seq_number || i + 1} · Email`,
          preview: s.subject ? `Objet : ${s.subject}` : 'Email de séquence Smartlead',
        },
      });
    });
    return items;
  }, [stats]);

  const timeline = realTimeline ?? TEMPLATE;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground title-glow">Campagnes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Comment je contacte chaque ICP ?</p>
        </div>
        <div className="flex items-center gap-2">
          {liveCampaigns.length > 0 && (
            <select
              value={effectiveCampaignId ?? ''}
              onChange={(e) => setPicked(e.target.value || null)}
              className="h-9 max-w-[220px] rounded-md border border-border bg-foreground/5 px-2.5 text-xs text-foreground backdrop-blur-sm"
            >
              {liveCampaigns.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!effectiveCampaignId || isFetching}
            onClick={() => {
              void refetch();
            }}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            Actualiser
          </Button>
        </div>
      </div>

      {/* Identité de la campagne */}
      <motion.div
        initial="hidden"
        animate="show"
        variants={fadeUp}
        className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-5"
      >
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 text-[17px] font-semibold text-foreground">
            <span className="truncate">{campaignName}</span>
            <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium', statusCls)}>
              {statusLabel}
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Variante : {currentPersona?.label ?? '—'} · séquence multicanale
          </p>
        </div>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--a1))]" />}
      </motion.div>

      {/* KPI campagne (en direct Smartlead) */}
      <motion.div {...staggerProps} className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'Contacts', icon: Users, node: analytics ? <AnimatedNumber value={analytics.sent} /> : '—' },
          {
            label: 'Ouverture',
            icon: MailOpen,
            node:
              analytics && analytics.open_rate !== null ? (
                <AnimatedNumber value={analytics.open_rate} format={(n) => `${n.toFixed(0)} %`} />
              ) : (
                '—'
              ),
          },
          {
            label: 'Réponse',
            icon: MessageSquare,
            node:
              analytics && analytics.reply_rate !== null ? (
                <AnimatedNumber value={analytics.reply_rate} format={(n) => `${n.toFixed(0)} %`} />
              ) : (
                '—'
              ),
          },
          { label: 'RDV', icon: CalendarCheck, node: '—' as React.ReactNode },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <motion.div
              key={k.label}
              variants={glassPop}
              className="glass rounded-2xl p-5 transition-transform duration-300 hover:-translate-y-0.5"
            >
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
        {!effectiveCampaignId
          ? 'Associe une campagne Smartlead à ce persona (section « Connexion Smartlead » ci-dessous) pour afficher les stats.'
          : stats && !stats.ok
            ? `Stats Smartlead indisponibles : ${stats.error ?? 'vérifie la clé API dans Providers.'}`
            : `Contacts / ouverture / réponse en direct depuis Smartlead${realTimeline ? ' · timeline réelle de la campagne' : ' · timeline = séquence type (Smartlead ne fournit pas d’étapes)'}. Le RDV n’est pas exposé par l’API.`}
      </p>

      {/* Variantes ICP (pilotées par les personas actifs) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Variante ICP :</span>
        {activePersonas.map((p) => (
          <button
            key={p.slug}
            onClick={() => {
              setVariant(p.slug);
              setPicked(null);
            }}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs transition',
              currentVariant === p.slug
                ? 'border-[hsl(var(--a1)/0.3)] bg-[hsl(var(--a1)/0.14)] font-medium text-[hsl(var(--a1))]'
                : 'border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground/70">{channelsNote}</span>
      </div>

      {/* Timeline */}
      <motion.div key={realTimeline ? 'real' : 'template'} {...staggerProps} className="relative pl-11">
        <div className="absolute bottom-2 left-[15px] top-2 w-0.5 bg-[hsl(var(--a1)/0.25)]" aria-hidden />
        {timeline.map((entry, i) => {
          if (entry.wait) {
            return (
              <motion.div
                key={`w${i}`}
                variants={fadeUp}
                className="relative mb-3.5 flex items-center gap-2 py-0.5 text-xs text-muted-foreground"
              >
                <span className="absolute -left-[37px] top-1/2 flex h-[18px] w-[18px] -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background">
                  <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                </span>
                Attendre <span className="font-medium text-foreground">{entry.wait}</span>
              </motion.div>
            );
          }
          const step = entry.step;
          if (!step) return null;
          const meta = CHANNEL_META[step.channel];
          const Icon = meta.icon;
          return (
            <motion.div key={`s${i}`} variants={glassPop} className="relative mb-3.5">
              <span
                className={cn(
                  'absolute -left-11 top-3.5 z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-background shadow-sm',
                  meta.ring,
                )}
              >
                <Icon className={cn('h-4 w-4', meta.color)} />
              </span>
              <div className="glass rounded-2xl p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{step.title}</span>
                  {step.tag && (
                    <span className="rounded-md bg-[#F0997B]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#F0997B]">
                      {step.tag}
                    </span>
                  )}
                </div>
                <div className="mt-2.5 truncate rounded-md border border-border bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">
                  {step.preview}
                </div>
              </div>
            </motion.div>
          );
        })}

        {/* Stop */}
        <motion.div variants={fadeUp} className="relative">
          <span className="absolute -left-11 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-emerald-400/40 bg-background shadow-sm">
            <Check className="h-4 w-4 text-emerald-500" />
          </span>
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3.5 text-[13px] text-emerald-500">
            Réponse reçue à n’importe quelle étape → séquence stoppée,{' '}
            <span className="text-muted-foreground">
              le prospect passe dans l’Inbox et les étapes suivantes (email, LinkedIn, courrier) sont annulées.
            </span>
          </div>
        </motion.div>
      </motion.div>

      {/* Connexion Smartlead réelle (fonctionnalité existante préservée) */}
      <div className="mt-8 border-t border-border/50 pt-6">
        <ProspectionCampaigns />
      </div>
    </div>
  );
}
