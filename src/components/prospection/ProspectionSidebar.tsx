import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowLeft, Building2, Key, Palette, FileText, Radar, Users, Megaphone } from 'lucide-react';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { ProspectionTab } from './ProspectionLayout';

interface ProspectionSidebarProps {
  activeTab: ProspectionTab;
  onNavigate: (tab: ProspectionTab) => void;
}

export function ProspectionSidebar({ activeTab, onNavigate }: ProspectionSidebarProps) {
  const navigate = useNavigate();

  const tabs = [
    { id: 'entreprises' as const, label: 'Entreprises', icon: Building2 },
    { id: 'triggers' as const, label: 'Declencheurs', icon: Radar },
    { id: 'personas' as const, label: 'Personas', icon: Users },
    { id: 'config' as const, label: 'Templates', icon: FileText },
    { id: 'branding' as const, label: 'Branding', icon: Palette },
    { id: 'campaigns' as const, label: 'Campagnes', icon: Megaphone },
    { id: 'providers' as const, label: 'Providers', icon: Key },
  ];

  return (
    <div className="w-64 h-screen bg-white dark:bg-background border-r border-gray-200 dark:border-border flex flex-col fixed">
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

      {/* Title */}
      <div className="p-6 border-b border-border">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Prospection</h1>
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
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm font-medium border-l-[3px]',
                isActive
                  ? 'border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                  : 'border-transparent text-gray-500 dark:text-white/60 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5'
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
