import { getTranslations } from 'next-intl/server';
import { AppTopBar } from '../chrome';
import { createClientOrNull } from '../../lib/supabase/server';
import { providerLabel } from '../../lib/labels';

type SeqState = 'done' | 'current' | 'planned';

interface Contact {
  firstName: string;
  lastName: string;
  jobTitle: string;
  linkedinUrl: string | null;
}
interface SignalRow {
  title: string;
  source: string;
  score: number;
  daysAgo: number;
}
interface SeqStep {
  channel: string;
  when: string;
  label: string;
  state: SeqState;
}
interface Company {
  name: string;
  siren: string | null;
  naf: string | null;
  city: string | null;
  headcount: number | null;
  contacts: Contact[];
  signals: SignalRow[];
  sequence: SeqStep[];
}

function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

async function loadCompany(orgId: string): Promise<Company | null> {
  const supabase = await createClientOrNull();
  if (!supabase || !orgId) return null;

  const account = (
    await supabase
      .from('accounts')
      .select('id,name,siren,naf_code,city,headcount')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ).data as { id: string; name: string; siren: string | null; naf_code: string | null; city: string | null; headcount: number | null } | null;
  if (!account) return null;

  const contactsRows =
    ((
      await supabase
        .from('contacts')
        .select('id,first_name,last_name,job_title,linkedin_url')
        .eq('account_id', account.id)
    ).data as { id: string; first_name: string | null; last_name: string | null; job_title: string | null; linkedin_url: string | null }[] | null) ?? [];

  const signalsRows =
    ((
      await supabase
        .from('signals')
        .select('title,provider_id,score,occurred_at')
        .eq('account_id', account.id)
        .order('occurred_at', { ascending: false })
    ).data as { title: string | null; provider_id: string | null; score: number | null; occurred_at: string }[] | null) ?? [];

  // Séquence : première inscription d'un contact de ce compte.
  let sequence: SeqStep[] = [];
  const contactIds = contactsRows.map((c) => c.id);
  if (contactIds.length > 0) {
    const enr = (
      await supabase
        .from('enrollments')
        .select('current_step,campaign_id')
        .in('contact_id', contactIds)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data as { current_step: number; campaign_id: string } | null;
    if (enr) {
      const steps =
        ((
          await supabase
            .from('sequence_steps')
            .select('position,channel,delay_hours,template_parent_id')
            .eq('campaign_id', enr.campaign_id)
            .order('position', { ascending: true })
        ).data as { position: number; channel: string; delay_hours: number; template_parent_id: string | null }[] | null) ?? [];
      const templates =
        ((await supabase.from('message_templates').select('id,name').eq('organization_id', orgId)).data as
          | { id: string; name: string }[]
          | null) ?? [];
      const nameById = new Map(templates.map((tpl) => [tpl.id, tpl.name]));
      let cumHours = 0;
      sequence = steps.map((s, idx) => {
        cumHours += s.delay_hours;
        const state: SeqState = idx < enr.current_step ? 'done' : idx === enr.current_step ? 'current' : 'planned';
        return {
          channel: s.channel.toUpperCase(),
          when: `J+${Math.round(cumHours / 24)}`,
          label: (s.template_parent_id && nameById.get(s.template_parent_id)) || `Étape ${s.position + 1}`,
          state,
        };
      });
    }
  }

  return {
    name: account.name,
    siren: account.siren,
    naf: account.naf_code,
    city: account.city,
    headcount: account.headcount,
    contacts: contactsRows.map((c) => ({
      firstName: c.first_name ?? '',
      lastName: c.last_name ?? '',
      jobTitle: c.job_title ?? '—',
      linkedinUrl: c.linkedin_url,
    })),
    signals: signalsRows.map((s) => ({
      title: s.title ?? '—',
      source: providerLabel(s.provider_id),
      score: s.score ?? 0,
      daysAgo: daysAgo(s.occurred_at),
    })),
    sequence,
  };
}

export default async function ProspectsPage() {
  const t = await getTranslations();
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';
  const company = await loadCompany(orgId);

  if (!company) {
    return (
      <div className="rs-shell">
        <AppTopBar active="prospects" />
        <main className="rs-main">
          <p className="rs-eyebrow">{t('prospects.eyebrow')}</p>
          <h1>{t('prospects.eyebrow')}</h1>
          <p className="rs-empty">{t('signals.empty')}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="rs-shell">
      <AppTopBar active="prospects" />
      <main className="rs-main">
        <p className="rs-eyebrow">{t('prospects.eyebrow')}</p>
        <h1>{company.name}</h1>
        <p className="rs-lead">
          {company.siren ? <span className="mono">{company.siren}</span> : null}
          {company.naf ? (
            <>
              {' · '}
              <span className="mono">{company.naf}</span>
            </>
          ) : null}
          {company.city ? <>{' · '}{company.city}</> : null}
          {company.headcount ? <>{' · '}{t('prospects.headcount', { n: company.headcount })}</> : null}
        </p>

        <div className="rs-grid2">
          <div style={{ display: 'grid', gap: '16px' }}>
            <div className="rs-card">
              <p className="rs-section-title">{t('prospects.signals')}</p>
              {company.signals.length === 0 ? (
                <p className="rs-row-sub">{t('signals.empty')}</p>
              ) : (
                company.signals.map((signal, i) => (
                  <div
                    key={`${signal.title}-${i}`}
                    className="rs-seq-row"
                    style={{ gridTemplateColumns: '1fr 120px 50px 80px' }}
                  >
                    <span>{signal.title}</span>
                    <span className="rs-chan">{signal.source}</span>
                    <span className="rs-score" data-high={signal.score >= 80}>
                      {signal.score}
                    </span>
                    <span className="rs-chan">{t('signals.daysAgo', { n: signal.daysAgo })}</span>
                  </div>
                ))
              )}
            </div>

            <div className="rs-card">
              <p className="rs-section-title">{t('prospects.sequence')}</p>
              {company.sequence.length === 0 ? (
                <p className="rs-row-sub">{t('prospects.noSequence')}</p>
              ) : (
                <div className="rs-seq">
                  {company.sequence.map((step, i) => (
                    <div key={`${step.when}-${step.channel}-${i}`} className="rs-seq-row">
                      <span className="rs-seq-dot" data-state={step.state} />
                      <span className="rs-seq-when">{step.when}</span>
                      <span className="rs-seq-label" data-current={step.state === 'current'}>
                        {step.label}
                      </span>
                      <span className="rs-chan">{step.channel}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="rs-card">
            <p className="rs-section-title">{t('prospects.contacts')}</p>
            {company.contacts.length === 0 ? (
              <p className="rs-row-sub">{t('signals.empty')}</p>
            ) : (
              company.contacts.map((contact, i) => (
                <div key={`${contact.lastName}-${i}`} className="rs-contact">
                  <span className="rs-avatar">
                    {`${contact.firstName.charAt(0)}${contact.lastName.charAt(0)}`}
                  </span>
                  <span>
                    <span className="rs-contact-name">{`${contact.firstName} ${contact.lastName}`}</span>
                    <br />
                    <span className="rs-contact-sub">{contact.jobTitle}</span>
                  </span>
                  {contact.linkedinUrl ? (
                    <a
                      className="rs-li"
                      href={contact.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`LinkedIn ${contact.firstName} ${contact.lastName}`}
                    >
                      {t('prospects.linkedin')}
                    </a>
                  ) : (
                    <span className="rs-li" style={{ color: 'var(--moss2)' }}>
                      {t('prospects.noProfile')}
                    </span>
                  )}
                </div>
              ))
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
