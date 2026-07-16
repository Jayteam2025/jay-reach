import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowLeft, LayoutDashboard, Radar, UserSquare2, Building2, Key, Palette, FileText, Target, Users, Send } from 'lucide-react';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { ProspectionTab } from './ProspectionLayout';

interface ProspectionSidebarProps {
  activeTab: ProspectionTab;
  onNavigate: (tab: ProspectionTab) => void;
}

export function ProspectionSidebar({ activeTab, onNavigate }: ProspectionSidebarProps) {
  const navigate = useNavigate();

  const tabs = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'signaux' as const, label: 'Signaux', icon: Radar },
    { id: 'prospects' as const, label: 'Prospects', icon: UserSquare2 },
    { id: 'entreprises' as const, label: 'Entreprises', icon: Building2 },
    { id: 'triggers' as const, label: 'Déclencheurs', icon: Target },
    { id: 'personas' as const, label: 'Personas', icon: Users },
    { id: 'config' as const, label: 'Templates', icon: FileText },
    { id: 'branding' as const, label: 'Branding', icon: Palette },
    { id: 'campaigns' as const, label: 'Campagnes', icon: Send },
    { id: 'providers' as const, label: 'Providers', icon: Key },
  ];

  return (
    <div className="w-64 h-screen bg-[rgb(var(--glass-bg))] backdrop-blur-xl border-r border-[rgb(var(--glass-border))] flex flex-col fixed z-20">
      {/* Back button + Theme toggle */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/dashboard')}
          className="gap-2 text-gray-500 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </Button>
        <ThemeSwitch />
      </div>

      {/* Title — bloc verre (effet carte) */}
      <div className="border-b border-border px-4 py-4">
        <div className="glass flex items-center gap-3 rounded-xl p-3 transition-transform duration-300 hover:-translate-y-0.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--a1)/0.16)] text-[hsl(var(--a1))]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
              <path d="M15.51 15.51a5 5 0 1 0 -7.02 0" />
              <path d="M18.36 18.36a9 9 0 1 0 -12.72 0" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight text-[hsl(var(--a1))]">Prospection</p>
            <p className="text-[11px] text-muted-foreground">Jay Reach</p>
          </div>
        </div>
      </div>

      {/* Navigation tabs */}
      <nav className="flex-1 px-3 py-4 space-y-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-sm font-medium border-l-[3px]',
                isActive
                  ? 'border-primary bg-[hsl(var(--a1)/0.16)] text-foreground shadow-[0_0_20px_hsl(var(--a1)/0.18)]'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-foreground/5'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
