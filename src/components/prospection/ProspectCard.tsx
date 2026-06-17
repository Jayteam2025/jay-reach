import { Mail, Linkedin, Instagram, Music } from 'lucide-react';
import { Prospect, getProspectLabel } from '@/hooks/useProspects';

interface ProspectCardProps {
  prospect: Prospect;
  onClick?: () => void;
}

// Couleurs par target_category (legacy). Le label vient de persona.label.
const CATEGORY_COLORS = {
  director: { bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-700 dark:text-violet-400', border: '#8B5CF6' },
  field_sales: { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-700 dark:text-cyan-400', border: '#06B6D4' },
  hr: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400', border: '#10B981' },
};

const CHANNEL_ICON_COLORS = {
  instagram: 'text-pink-400',
  tiktok: 'text-cyan-400',
};

// Couleur de l'icone Mail selon le niveau de verif (cf EmailStatusBadge.tsx)
const EMAIL_STATUS_ICON_COLORS: Record<string, string> = {
  verified: 'text-emerald-500',
  deduced_high: 'text-sky-500',
  deduced_unverified: 'text-amber-500',
  unverified: 'text-gray-400 dark:text-white/40',
};

const EMAIL_STATUS_TITLES: Record<string, string> = {
  verified: 'Email vérifié',
  deduced_high: 'Email déduit (pattern fiable)',
  deduced_unverified: 'Email déduit, non vérifié',
  unverified: 'Email non vérifié',
};

export function ProspectCard({ prospect, onClick }: ProspectCardProps) {
  const colors = CATEGORY_COLORS[prospect.target_category];
  const label = getProspectLabel(prospect);

  return (
    <div
      onClick={onClick}
      className="border border-l-[3px] border-border hover:border-gray-300 dark:hover:border-white/20 rounded-lg p-3 bg-white dark:bg-card cursor-pointer transition-colors shadow-sm dark:shadow-none"
      style={{ borderLeftColor: colors.border }}
    >
      {/* Top row: Name + Category badge */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
          {prospect.first_name} {prospect.last_name}
        </h3>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap ${colors.bg} ${colors.text}`}
        >
          {label}
        </span>
      </div>

      {/* Second row: Job title + Company */}
      <p className="text-xs text-gray-500 dark:text-white/50 truncate mb-3">
        {prospect.job_title && prospect.company_name ? (
          <>
            {prospect.job_title} • {prospect.company_name}
          </>
        ) : prospect.job_title ? (
          prospect.job_title
        ) : prospect.company_name ? (
          prospect.company_name
        ) : (
          '—'
        )}
      </p>

      {/* Bottom row: Channel icons + Qualification score */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {prospect.email && (
            <Mail
              className={`w-3.5 h-3.5 ${EMAIL_STATUS_ICON_COLORS[prospect.email_validation_status] ?? EMAIL_STATUS_ICON_COLORS.unverified}`}
              aria-label={EMAIL_STATUS_TITLES[prospect.email_validation_status] ?? EMAIL_STATUS_TITLES.unverified}
            />
          )}
          {prospect.linkedin_url && (
            <Linkedin className="w-3.5 h-3.5 text-sky-400" />
          )}
          {prospect.instagram_url && (
            <Instagram className={`w-3.5 h-3.5 ${CHANNEL_ICON_COLORS.instagram}`} />
          )}
          {prospect.tiktok_url && (
            <Music className={`w-3.5 h-3.5 ${CHANNEL_ICON_COLORS.tiktok}`} />
          )}
        </div>
        <span className="text-xs font-medium text-gray-600 dark:text-white/70">
          {prospect.qualification_score}%
        </span>
      </div>
    </div>
  );
}
