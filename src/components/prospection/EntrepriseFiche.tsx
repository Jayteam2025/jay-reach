import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExternalLink, MapPin, Loader2, RefreshCw } from 'lucide-react';
import { useCompanyProgress } from '@/hooks/useProspectActions';
import { type EnrichedCompany } from '@/hooks/useEnrichedCompanies';
import { cn } from '@/lib/utils';
import { CrmDetectionBadge } from '@/features/crm-detection/CrmDetectionBadge';
import { useCrmDetection } from '@/features/crm-detection/useCrmDetection';
import { useCompanyMessages, type ProspectMessage } from '@/features/messages/useCompanyMessages';
import { ProfileBlock } from '@/features/messages/ProfileBlock';
import { BulkSendValidEmailsPanel } from '@/features/smartlead/BulkSendValidEmailsPanel';
import { getProfileLabel } from '@/features/messages/profile-helpers';
import { EnrichmentStatusPanel } from '@/features/enrichment/EnrichmentStatusPanel';

interface Props {
  company: EnrichedCompany;
}

export function EntrepriseFiche({ company }: Props) {
  const { messages, regenerate, isRegenerating } = useCompanyMessages(company);
  const { data: progress } = useCompanyProgress(company.company_group_id);

  const enrichment = company.profiles[0]?.enrichment_data as Record<string, unknown> | null;
  const sector = company.profiles[0]?.company_sector;
  const siren = company.profiles[0]?.company_siren;
  const { detection: crmDetection, redetect: redetectCrm, isRedetecting: isRedetectingCrm } =
    useCrmDetection(company.company_group_id);

  const hasAnyMessage = messages.length > 0;
  // FullEnrich/INSEE renvoient souvent le CP/ville deja inclus dans
  // company_address (ex: "12 ROUTE DE PITGAM 59380 STEENE"). On ne concatene
  // le CP/ville que s'ils ne sont pas deja presents dans la chaine adresse.
  const addrStr = (enrichment?.company_address as string | undefined) || '';
  const zip = (enrichment?.company_zip as string | undefined) || '';
  const city = (enrichment?.company_city as string | undefined) || '';
  const addrContainsZip = zip && addrStr.includes(zip);
  const addrContainsCity = city && addrStr.toLowerCase().includes(city.toLowerCase());
  const fullAddress = [
    addrStr,
    addrContainsZip ? '' : zip,
    addrContainsCity ? '' : city,
  ].filter(Boolean).join(' ');

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-3xl px-8 py-10">
        {/* Company header — editorial style */}
        <header className="mb-10">
          <div className="flex items-start justify-between gap-6 mb-4">
            <h2 className="font-heading text-[32px] font-semibold text-foreground tracking-tight leading-none">
              {company.company_name}
            </h2>
            <div className="flex items-center gap-2 shrink-0">
              <EnrichmentStatusPanel company={company} />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-[12px] gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => regenerate()}
                disabled={isRegenerating}
              >
                {isRegenerating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {hasAnyMessage ? 'Regenerer les messages' : 'Generer les messages'}
              </Button>
            </div>
          </div>

          {sector && (
            <p className="text-[14px] text-muted-foreground mb-4">{sector}</p>
          )}

          <dl className="grid grid-cols-[120px_1fr] gap-x-6 gap-y-2 text-[13px]">
            {siren && (
              <>
                <dt className="text-muted-foreground/70">SIREN</dt>
                <dd className="text-foreground font-mono tabular-nums">{siren}</dd>
              </>
            )}
            {enrichment?.company_website ? (
              <>
                <dt className="text-muted-foreground/70">Site web</dt>
                <dd>
                  <a
                    href={`https://${enrichment.company_website as string}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-foreground hover:text-violet-500 underline-offset-4 hover:underline transition-colors"
                  >
                    {enrichment.company_website as string}
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </a>
                </dd>
              </>
            ) : null}
            {fullAddress && (
              <>
                <dt className="text-muted-foreground/70">Adresse</dt>
                <dd className="text-foreground inline-flex items-start gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
                  <span>{fullAddress}</span>
                </dd>
              </>
            )}
            <dt className="text-muted-foreground/70">CRM</dt>
            <dd>
              <CrmDetectionBadge
                detection={crmDetection}
                onRedetect={redetectCrm}
                isRedetecting={isRedetectingCrm}
              />
            </dd>
          </dl>

          {progress && progress.total > 0 && (
            <div className="mt-6 flex items-center gap-3">
              <div className="flex-1 h-0.5 bg-foreground/10 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500 ease-out',
                    progress.percent === 100 ? 'bg-emerald-500' : 'bg-foreground'
                  )}
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <span className={cn(
                'text-[11px] font-mono tabular-nums tracking-tight',
                progress.percent === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
              )}>
                {progress.completed}/{progress.total}
              </span>
            </div>
          )}
        </header>

        {/* Profiles — onglets RH / Dir Co / Commerciaux */}
        <CategoryTabs company={company} messages={messages} />
      </div>
    </div>
  );
}

// =============================================================================
// CategoryTabs — un onglet par PERSONA présent (plus de hr/director/sales en dur).
// Dérivé de company.personaGroups (clé = slug persona). Seuls les onglets non
// vides sont affichés. Fonctionne pour n'importe quel persona du workspace.
// =============================================================================

function CategoryTabs({
  company,
  messages,
}: {
  company: EnrichedCompany;
  messages: ProspectMessage[];
}) {
  const tabs = useMemo(() => {
    return Object.entries(company.personaGroups)
      .filter(([, profiles]) => profiles.length > 0)
      .map(([slug, profiles]) => ({
        slug,
        // Libellé = label du persona résolu (fallback slug pour les rows sans persona).
        label: profiles[0] ? getProfileLabel(profiles[0]) : slug,
        count: profiles.length,
        profiles,
      }));
  }, [company]);

  const [activeTab, setActiveTab] = useState<string>(tabs[0]?.slug ?? '');

  // Si l'onglet actif disparait (ex: ajout/retrait de profils), retombe sur le premier
  useEffect(() => {
    if (tabs.length > 0 && tabs[0] && !tabs.some(t => t.slug === activeTab)) {
      setActiveTab(tabs[0].slug);
    }
  }, [tabs, activeTab]);

  if (tabs.length === 0) {
    return (
      <div className="py-10 text-center text-[13px] text-muted-foreground">
        Aucun contact enrichi pour cette entreprise.
      </div>
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto w-full justify-start gap-6 flex-wrap">
        {tabs.map(tab => (
          <TabsTrigger
            key={tab.slug}
            value={tab.slug}
            className="bg-transparent px-0 pb-3 pt-0 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground text-muted-foreground font-normal text-[13px] gap-2 h-auto"
          >
            <span>{tab.label}</span>
            <span
              className={cn(
                'inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded text-[11px] font-mono tabular-nums',
                activeTab === tab.slug
                  ? 'bg-foreground/10 text-foreground'
                  : 'bg-muted text-muted-foreground/70',
              )}
            >
              {tab.count}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map(tab => (
        <TabsContent key={tab.slug} value={tab.slug} className="mt-8 focus-visible:ring-0 space-y-10">
          <BulkSendValidEmailsPanel profiles={tab.profiles} label={tab.label} />
          {tab.profiles.map((profile, idx) => (
            <ProfileBlock
              key={profile.id}
              profile={profile}
              company={company}
              messages={messages.filter(m => m.prospect_id === profile.id)}
              index={idx + 1}
              total={tab.profiles.length}
            />
          ))}
        </TabsContent>
      ))}
    </Tabs>
  );
}


