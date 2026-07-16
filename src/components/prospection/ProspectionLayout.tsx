import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { ProspectionSidebar } from './ProspectionSidebar';
import { tabTransition } from '@/lib/motion';

// Chaque onglet est code-split en chunk async (Jay Reach 1.5.6) : seul l'onglet
// actif (et ses dependances lourdes : xlsx/mammoth pour l'import, dnd-kit pour
// le kanban) est telecharge. Les composants sont des exports nommes, d'ou le
// remap .then(m => ({ default: m.X })).
const ProspectionDashboard = lazy(() =>
  import('./ProspectionDashboard').then((m) => ({ default: m.ProspectionDashboard })));
const ProspectionSignaux = lazy(() =>
  import('./ProspectionSignaux').then((m) => ({ default: m.ProspectionSignaux })));
const ProspectionProspects = lazy(() =>
  import('./ProspectionProspects').then((m) => ({ default: m.ProspectionProspects })));
const ProspectionEntreprises = lazy(() =>
  import('./ProspectionEntreprises').then((m) => ({ default: m.ProspectionEntreprises })));
const ProspectionConfig = lazy(() =>
  import('./ProspectionConfig').then((m) => ({ default: m.ProspectionConfig })));
const ProspectionTriggers = lazy(() =>
  import('./ProspectionTriggers').then((m) => ({ default: m.ProspectionTriggers })));
const ProspectionPersonas = lazy(() =>
  import('./ProspectionPersonas').then((m) => ({ default: m.ProspectionPersonas })));
const ProspectionBranding = lazy(() =>
  import('./ProspectionBranding').then((m) => ({ default: m.ProspectionBranding })));
const ProspectionProviders = lazy(() =>
  import('./ProspectionProviders').then((m) => ({ default: m.ProspectionProviders })));
const ProspectionCampagnes = lazy(() =>
  import('./ProspectionCampagnes').then((m) => ({ default: m.ProspectionCampagnes })));

export type ProspectionTab =
  | 'dashboard'
  | 'signaux'
  | 'prospects'
  | 'entreprises'
  | 'triggers'
  | 'personas'
  | 'config'
  | 'branding'
  | 'campaigns'
  | 'providers';

const VALID_TABS: ProspectionTab[] = [
  'dashboard',
  'signaux',
  'prospects',
  'entreprises',
  'triggers',
  'personas',
  'config',
  'branding',
  'campaigns',
  'providers',
];

export function ProspectionLayout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as ProspectionTab | null;
  const activeTab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'dashboard';

  const setActiveTab = (tab: ProspectionTab) => {
    setSearchParams(tab === 'dashboard' ? {} : { tab });
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <ProspectionDashboard />;
      case 'signaux':
        return <ProspectionSignaux />;
      case 'prospects':
        return <ProspectionProspects />;
      case 'entreprises':
        return <ProspectionEntreprises />;
      case 'triggers':
        return <ProspectionTriggers />;
      case 'personas':
        return <ProspectionPersonas />;
      case 'config':
        return <ProspectionConfig />;
      case 'branding':
        return <ProspectionBranding />;
      case 'campaigns':
        return <ProspectionCampagnes />;
      case 'providers':
        return <ProspectionProviders />;
      default:
        return <ProspectionEntreprises />;
    }
  };

  return (
    <div className="relative flex min-h-screen bg-background overflow-hidden">
      <ProspectionSidebar activeTab={activeTab} onNavigate={setActiveTab} />
      <main className="relative z-10 flex-1 ml-64 p-6 overflow-x-hidden">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
            </div>
          }
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={tabTransition.initial}
              animate={tabTransition.animate}
              exit={tabTransition.exit}
              transition={tabTransition.transition}
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </Suspense>
      </main>
    </div>
  );
}
