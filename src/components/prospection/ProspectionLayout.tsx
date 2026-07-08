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
const ProspectionCampaigns = lazy(() =>
  import('./ProspectionCampaigns').then((m) => ({ default: m.ProspectionCampaigns })));

export type ProspectionTab =
  | 'entreprises'
  | 'triggers'
  | 'personas'
  | 'config'
  | 'branding'
  | 'campaigns'
  | 'providers';

const VALID_TABS: ProspectionTab[] = [
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
  const activeTab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'entreprises';

  const setActiveTab = (tab: ProspectionTab) => {
    setSearchParams(tab === 'entreprises' ? {} : { tab });
  };

  const renderContent = () => {
    switch (activeTab) {
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
        return <ProspectionCampaigns />;
      case 'providers':
        return <ProspectionProviders />;
      default:
        return <ProspectionEntreprises />;
    }
  };

  return (
    <div className="relative flex min-h-screen bg-background overflow-hidden">
      {/* Fond d'ambiance : halos animés derrière le verre. z-0 (pas -z-10) pour
          passer devant le bg-background opaque ; le contenu repasse au-dessus (z-10). */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="orb-purple aurora-orb -top-40 left-40" />
        <div className="orb-blue aurora-orb aurora-orb--slow top-1/4 right-10" />
        <div className="orb-purple aurora-orb bottom-[-14rem] left-1/2 opacity-80" />
      </div>

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
