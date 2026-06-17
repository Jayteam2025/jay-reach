import { useState } from 'react';
import { EmailStatusBadge } from './EmailStatusBadge';
import { useProspect, useUpdateProspectStatus, getProspectLabel } from '@/hooks/useProspects';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Mail,
  Phone,
  Linkedin,
  Instagram,
  Music,
  ExternalLink,
  Globe,
  Building2,
  Hash,
  FileText,
  ChevronDown,
  Twitter,
  Loader2,
} from 'lucide-react';

interface ProspectSidePanelProps {
  prospectId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Couleur stable neutre pour tous les personas
const PERSONA_COLOR = { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400' };

const STAGES = [
  { key: 'new', label: 'Signal détecté' },
  { key: 'qualified', label: 'Qualifié' },
  { key: 'in_sequence', label: 'En séquence' },
  { key: 'replied', label: 'Répondu' },
  { key: 'meeting_booked', label: 'RDV obtenu' },
  { key: 'converted', label: 'Converti' },
  { key: 'lost', label: 'Perdu' },
];

export function ProspectSidePanel({ prospectId, open, onOpenChange }: ProspectSidePanelProps) {
  const { data: prospect, isLoading } = useProspect(prospectId);
  const updateStatusMutation = useUpdateProspectStatus();
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);

  if (!open || !prospectId) return null;

  const handleStatusChange = (newStatus: string) => {
    if (prospect) {
      updateStatusMutation.mutate({ id: prospect.id, status: newStatus });
      setIsStatusDropdownOpen(false);
    }
  };


  const categoryColors = prospect ? PERSONA_COLOR : null;
  const categoryLabel = prospect ? getProspectLabel(prospect) : null;

  const getStatusLabel = (status: string) => {
    return STAGES.find((s) => s.key === status)?.label || status;
  };

  const getScoreBarColor = (score: number) => {
    if (score <= 30) return '#EF4444'; // red-500
    if (score <= 60) return '#F59E0B'; // amber-500
    if (score <= 80) return '#60A5FA'; // blue-500
    return '#10B981'; // emerald-500
  };

  const getStatusBadgeClass = (status: string) => {
    const statusColorMap: Record<string, string> = {
      new: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
      qualified: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400',
      in_sequence: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
      replied: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400',
      meeting_booked: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
      converted: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
      lost: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    };
    return statusColorMap[status] || 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
  };

  const renderSocialLink = (url: string | null, icon: React.ReactNode, label: string) => {
    if (!url) return null;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-gray-600 dark:text-white/70 hover:text-gray-900 dark:hover:text-white transition-colors"
        title={label}
      >
        {icon}
      </a>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-[400px] p-0 flex flex-col dark:bg-card dark:border-border"
        side="right"
      >
        {isLoading ? (
          <div className="flex justify-center items-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
          </div>
        ) : prospect ? (
          <>
            {/* Header */}
            <SheetHeader className="border-b border-border p-6 pb-4 space-y-3">
              <div className="flex items-start justify-between">
                <SheetTitle className="text-base font-semibold text-gray-900 dark:text-white">
                  {prospect.first_name} {prospect.last_name}
                </SheetTitle>
                {categoryColors && categoryLabel && (
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded whitespace-nowrap ${categoryColors.bg} ${categoryColors.text}`}
                  >
                    {categoryLabel}
                  </span>
                )}
              </div>

              {/* Qualification score bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-600 dark:text-white/60">
                    Score de qualification
                  </span>
                  <span className="text-xs font-semibold" style={{ color: getScoreBarColor(prospect.qualification_score) }}>
                    {prospect.qualification_score}%
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full transition-all duration-300"
                    style={{ width: `${prospect.qualification_score}%`, backgroundColor: getScoreBarColor(prospect.qualification_score) }}
                  />
                </div>
              </div>

              {/* Status badge */}
              <div>
                <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${getStatusBadgeClass(prospect.status)}`}>
                  {getStatusLabel(prospect.status)}
                </span>
              </div>
            </SheetHeader>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-6">
                {/* Identity section */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
                    Identité
                  </h3>
                  <div className="space-y-2">
                    {prospect.job_title && (
                      <div>
                        <p className="text-xs text-gray-500 dark:text-white/50">Poste</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {prospect.job_title}
                        </p>
                      </div>
                    )}
                    {prospect.company_name && (
                      <div>
                        <p className="text-xs text-gray-500 dark:text-white/50">Entreprise</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {prospect.company_name}
                        </p>
                      </div>
                    )}
                    {prospect.company_city && (
                      <div>
                        <p className="text-xs text-gray-500 dark:text-white/50">Localité</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {prospect.company_city}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Contact & Social section */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
                    Contact & Réseaux
                  </h3>
                  <div className="space-y-3">
                    {prospect.email && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Mail className="w-4 h-4 text-gray-400 dark:text-white/40 flex-shrink-0" />
                        <a
                          href={`mailto:${prospect.email}`}
                          className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate"
                        >
                          {prospect.email}
                        </a>
                        <EmailStatusBadge status={prospect.email_validation_status} deliverabilityStatus={prospect.deliverability_status} />
                      </div>
                    )}
                    {prospect.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-gray-400 dark:text-white/40 flex-shrink-0" />
                        <a
                          href={`tel:${prospect.phone}`}
                          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {prospect.phone}
                        </a>
                      </div>
                    )}

                    {/* Social icons */}
                    {(prospect.linkedin_url ||
                      prospect.instagram_url ||
                      prospect.tiktok_url ||
                      prospect.twitter_url) && (
                      <div className="flex items-center gap-3 pt-2">
                        {renderSocialLink(
                          prospect.linkedin_url,
                          <Linkedin className="w-4 h-4" />,
                          'LinkedIn'
                        )}
                        {renderSocialLink(
                          prospect.instagram_url,
                          <Instagram className="w-4 h-4" />,
                          'Instagram'
                        )}
                        {renderSocialLink(
                          prospect.tiktok_url,
                          <Music className="w-4 h-4" />,
                          'TikTok'
                        )}
                        {renderSocialLink(
                          prospect.twitter_url,
                          <Twitter className="w-4 h-4" />,
                          'Twitter'
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Company info section */}
                {(prospect.company_siren || prospect.company_size || prospect.company_sector) && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
                      Informations Entreprise
                    </h3>
                    <div className="space-y-2">
                      {prospect.company_siren && (
                        <div className="flex items-start gap-2">
                          <Hash className="w-4 h-4 text-gray-400 dark:text-white/40 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs text-gray-500 dark:text-white/50">SIREN</p>
                            <p className="text-sm font-medium text-gray-900 dark:text-white font-mono">
                              {prospect.company_siren}
                            </p>
                          </div>
                        </div>
                      )}
                      {prospect.company_size && (
                        <div className="flex items-start gap-2">
                          <Building2 className="w-4 h-4 text-gray-400 dark:text-white/40 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs text-gray-500 dark:text-white/50">Taille</p>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                              {prospect.company_size}
                            </p>
                          </div>
                        </div>
                      )}
                      {prospect.company_sector && (
                        <div className="flex items-start gap-2">
                          <Globe className="w-4 h-4 text-gray-400 dark:text-white/40 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs text-gray-500 dark:text-white/50">Secteur</p>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                              {prospect.company_sector}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Notes section */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
                    Notes
                  </h3>
                  <div className="p-3 rounded-lg bg-gray-50 dark:bg-white/5 border border-border">
                    <p className="text-sm text-gray-900 dark:text-white">
                      {prospect.notes || (
                        <span className="text-gray-400 dark:text-white/40 italic">Aucune note</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer - Actions */}
            <div className="border-t border-border p-6 space-y-3 flex flex-col gap-3">
              <div className="relative">
                <button
                  onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                  className="w-full h-9 px-3 rounded-md border border-gray-300 dark:border-white/25 bg-white dark:bg-white/10 text-gray-900 dark:text-white text-sm font-medium flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
                >
                  <span>Changer statut</span>
                  <ChevronDown
                    className="w-4 h-4 transition-transform"
                    style={{
                      transform: isStatusDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                  />
                </button>

                {isStatusDropdownOpen && (
                  <div className="absolute bottom-full left-0 right-0 mb-2 rounded-md border border-border bg-white dark:bg-card shadow-lg z-50 max-h-60 overflow-y-auto">
                    {STAGES.map((stage) => (
                      <button
                        key={stage.key}
                        onClick={() => handleStatusChange(stage.key)}
                        disabled={updateStatusMutation.isPending}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                          prospect.status === stage.key
                            ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 font-medium'
                            : 'text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-white/5'
                        } ${updateStatusMutation.isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {stage.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {prospect.source_signal_id && (
                <a
                  href={`/prospection/signals/${prospect.source_signal_id}`}
                  className="w-full h-9 rounded-md border border-gray-300 dark:border-white/20 text-gray-900 dark:text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  Voir signal
                  <ExternalLink className="w-3 h-3 ml-auto" />
                </a>
              )}
            </div>
          </>
        ) : (
          <div className="flex justify-center items-center h-full text-gray-500 dark:text-white/50">
            Prospect introuvable
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
