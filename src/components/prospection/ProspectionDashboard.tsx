import { Users, Radio, MessageSquare, TrendingUp, Loader2, Kanban } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useProspectStats } from '@/hooks/useProspectStats';

interface KPICardProps {
  label: string;
  value: string | number;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor?: string;
  iconColor?: string;
  bgClass?: string;
}

function KPICard({
  label,
  value,
  subtitle,
  icon: Icon,
  accentColor = 'violet',
  iconColor = 'text-foreground/50',
  bgClass,
}: KPICardProps) {
  return (
    <div className={`border border-l-4 border-border rounded-lg p-4 ${bgClass || 'bg-card'}`}
      style={{ borderLeftColor: accentColor === 'violet' ? '#8B5CF6' : accentColor === 'blue' ? '#60A5FA' : accentColor === 'amber' ? '#F59E0B' : '#10B981' }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground/70">{label}</h3>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <div className="text-3xl font-bold mb-2" style={{ color: accentColor === 'violet' ? '#8B5CF6' : accentColor === 'blue' ? '#60A5FA' : accentColor === 'amber' ? '#F59E0B' : '#10B981' }}>{value}</div>
      <p className="text-xs text-foreground/60">{subtitle}</p>
    </div>
  );
}

export function ProspectionDashboard() {
  const [, setSearchParams] = useSearchParams();
  const { data: stats, isLoading } = useProspectStats();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-foreground/50" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-12">
        <p className="text-foreground/60">Impossible de charger les statistiques</p>
      </div>
    );
  }

  const newProspects = stats.prospectsByStatus.new || 0;
  const qualifiedProspects = stats.prospectsByStatus.qualified || 0;
  const inSequenceProspects = stats.prospectsByStatus.in_sequence || 0;

  const rawSignals = stats.signalsByStatus.raw || 0;
  const matchedSignals = stats.signalsByStatus.matched || 0;

  const draftMessages = stats.messagesByStatus.draft || 0;
  const sentMessages = stats.messagesByStatus.sent || 0;

  const conversionRate =
    stats.totalProspects > 0
      ? Math.round((stats.prospectsByStatus.converted || 0) / stats.totalProspects * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
        <p className="text-foreground/60 mt-1">Aperçu global de vos campagnes de prospection</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Prospects"
          value={stats.totalProspects}
          subtitle={`${newProspects} nouveau, ${qualifiedProspects} qualifiés, ${inSequenceProspects} en séquence`}
          icon={Users}
          accentColor="violet"
          iconColor="text-violet-500"
          bgClass="bg-violet-50/50 dark:bg-card"
        />
        <KPICard
          label="Signaux"
          value={stats.totalSignals}
          subtitle={`${rawSignals} bruts, ${matchedSignals} matchés`}
          icon={Radio}
          accentColor="blue"
          iconColor="text-blue-400"
          bgClass="bg-blue-50/50 dark:bg-card"
        />
        <KPICard
          label="Brouillons"
          value={draftMessages}
          subtitle={`${sentMessages} messages envoyés`}
          icon={MessageSquare}
          accentColor="amber"
          iconColor="text-amber-500"
          bgClass="bg-amber-50/50 dark:bg-card"
        />
        <KPICard
          label="Conversion"
          value={`${conversionRate}%`}
          subtitle={`Prospects convertis / Total`}
          icon={TrendingUp}
          accentColor="emerald"
          iconColor="text-emerald-500"
          bgClass="bg-emerald-50/50 dark:bg-card"
        />
      </div>

      {/* Quick Actions */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-foreground">Actions rapides</h3>
        <div className="grid grid-cols-3 gap-4">
          {/* Scraper les offres */}
          <div
            onClick={() => setSearchParams({ tab: 'signals' })}
            className="rounded-lg border border-border bg-violet-50 dark:bg-violet-500/10 p-4 hover:shadow-md dark:hover:shadow-lg transition-all duration-150 cursor-pointer"
          >
            <Radio className="w-5 h-5 text-violet-500 mb-2" />
            <h4 className="font-semibold text-foreground mb-1">Scraper les offres</h4>
            <p className="text-xs text-foreground/60">Lancer la détection de signaux</p>
          </div>

          {/* Voir le pipeline */}
          <div
            onClick={() => setSearchParams({ tab: 'pipeline' })}
            className="rounded-lg border border-border bg-blue-50 dark:bg-blue-500/10 p-4 hover:shadow-md dark:hover:shadow-lg transition-all duration-150 cursor-pointer"
          >
            <Kanban className="w-5 h-5 text-blue-500 mb-2" />
            <h4 className="font-semibold text-foreground mb-1">Voir le pipeline</h4>
            <p className="text-xs text-foreground/60">Gérer vos prospects</p>
          </div>

          {/* Générer des messages */}
          <div
            onClick={() => setSearchParams({ tab: 'messages' })}
            className="rounded-lg border border-border bg-amber-50 dark:bg-amber-500/10 p-4 hover:shadow-md dark:hover:shadow-lg transition-all duration-150 cursor-pointer"
          >
            <MessageSquare className="w-5 h-5 text-amber-500 mb-2" />
            <h4 className="font-semibold text-foreground mb-1">Générer des messages</h4>
            <p className="text-xs text-foreground/60">Créer des messages personnalisés</p>
          </div>
        </div>
      </div>
    </div>
  );
}
