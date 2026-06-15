import type { EnrichedCompany, EnrichedProfile } from '@/hooks/useEnrichedCompanies';
import { EmailChannel } from './channels/EmailChannel';
import { PostalChannel } from './channels/PostalChannel';
import { LinkedInChannel } from './channels/LinkedInChannel';
import { PhoneChannel } from './channels/PhoneChannel';
import { getProfileLabel, hasApplicableChannel } from './profile-helpers';
import type { ProspectMessage } from './useCompanyMessages';

/**
 * Bloc detail d'un contact : nom, titre, channels (email/postal/linkedin/phone).
 * Utilise dans MessagesPanel sous chaque tab catégorie.
 */
export function ProfileBlock({
  profile,
  company,
  messages,
  index,
  total,
}: {
  profile: EnrichedProfile;
  company: EnrichedCompany;
  messages: ProspectMessage[];
  /** Numéro 1-based de ce profil dans sa catégorie. */
  index?: number;
  /** Total de profils dans cette catégorie. */
  total?: number;
}) {
  const fullName = `${profile.first_name} ${profile.last_name}`;
  const emailMessage = messages.find((m) => m.channel === 'email');
  const postalMessage = messages.find((m) => m.channel === 'postal_letter');

  const baseLabel = getProfileLabel(profile);
  const categoryLabel = total && total > 1 && index
    ? `${baseLabel} · ${index}/${total}`
    : baseLabel;

  const showFallbackHint = !hasApplicableChannel(profile) && messages.length === 0;

  return (
    <article>
      <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.15em] mb-2">
        {categoryLabel}
      </p>

      <div className="mb-5">
        <h3 className="font-heading text-[22px] font-semibold text-foreground leading-tight tracking-tight">
          {fullName}
        </h3>
        {profile.job_title && (
          <p className="text-[14px] text-muted-foreground mt-1">{profile.job_title}</p>
        )}
      </div>

      <div className="space-y-3">
        <EmailChannel profile={profile} company={company} message={emailMessage} />

        {profile.target_category === 'director' && (
          <PostalChannel profile={profile} company={company} message={postalMessage} />
        )}

        <LinkedInChannel profile={profile} />

        {profile.phone && <PhoneChannel phone={profile.phone} />}
      </div>

      {showFallbackHint && (
        <p className="mt-4 text-[12px] text-muted-foreground/70">
          Aucun canal automatisable. Contact manuel via LinkedIn recommandé.
        </p>
      )}
    </article>
  );
}
