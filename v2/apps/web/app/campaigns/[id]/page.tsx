import { notFound } from 'next/navigation';
import { AppTopBar } from '../../chrome';
import { createClientOrNull } from '../../../lib/supabase/server';
import type { CampaignDetail, Channel, SeqStepDetail } from '../../../lib/sample-campaign-detail';
import { CampaignDetailView } from './detail-view';

const CHANNEL_TITLE: Record<Channel, string> = {
  email: 'Email',
  linkedin_invite: 'Invitation LinkedIn',
  linkedin_message: 'Message LinkedIn',
  letter: 'Courrier manuscrit',
  call: 'Appel',
};

function extractVars(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) out.add(m[1]!);
  return [...out];
}

function daysAgo(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClientOrNull();

  const campaign = supabase
    ? ((
        await supabase
          .from('campaigns')
          .select('id,organization_id,name,status,entry_rules,daily_cap,created_at')
          .eq('id', id)
          .maybeSingle()
      ).data as
        | { id: string; organization_id: string; name: string; status: string; entry_rules: unknown; daily_cap: number | null; created_at: string }
        | null)
    : null;
  if (!campaign) {
    notFound();
  }

  const stat =
    ((await supabase!.from('campaign_stats').select('*').eq('id', id).maybeSingle()).data as
      | { enrolled: number; sent: number; contacted: number; invites: number; accepted: number; replies: number; channels: number }
      | null) ?? { enrolled: 0, sent: 0, contacted: 0, invites: 0, accepted: 0, replies: 0, channels: 0 };

  const stepRows =
    ((
      await supabase!
        .from('sequence_steps')
        .select('id,position,channel,delay_hours,template_parent_id,conditions')
        .eq('campaign_id', id)
        .order('position', { ascending: true })
    ).data as
      | { id: string; position: number; channel: Channel; delay_hours: number; template_parent_id: string | null; conditions: { requires?: string } | null }[]
      | null) ?? [];

  const templates =
    ((
      await supabase!
        .from('message_templates')
        .select('id,parent_id,name,channel,locale,version,subject,body,is_active')
        .eq('organization_id', campaign.organization_id)
    ).data as
      | { id: string; parent_id: string | null; name: string; channel: Channel; locale: string; version: number; subject: string | null; body: string; is_active: boolean }[]
      | null) ?? [];

  // Lignée = parent_id, sinon id de la racine. On résume chaque lignée (nom, canal)
  // et on retient la version ACTIVE (fr en priorité) pour l'aperçu de l'étape.
  const famKey = (t: { parent_id: string | null; id: string }): string => t.parent_id ?? t.id;
  const familyMap = new Map<string, { familyId: string; name: string; channel: Channel }>();
  const activeByFamily = new Map<string, { name: string; subject: string | null; body: string }>();
  for (const t of templates) {
    const fam = famKey(t);
    if (!familyMap.has(fam)) familyMap.set(fam, { familyId: fam, name: t.name, channel: t.channel });
    if (t.is_active) {
      const prev = activeByFamily.get(fam);
      // fr prime ; sinon on garde la première active rencontrée.
      if (!prev || t.locale === 'fr') activeByFamily.set(fam, { name: t.name, subject: t.subject, body: t.body });
    }
  }
  const templateFamilies = [...familyMap.values()];

  const steps: SeqStepDetail[] = stepRows.map((s, i) => {
    const active = s.template_parent_id ? activeByFamily.get(s.template_parent_id) : undefined;
    const body = active?.body ?? '';
    const preview = body ? body.split('\n')[0]! : `${CHANNEL_TITLE[s.channel]} — étape ${i + 1}`;
    const requires = s.conditions?.requires;
    const conditionKind =
      requires === 'previous_opened' || requires === 'previous_accepted' || requires === 'no_reply' ? requires : null;
    return {
      n: i + 1,
      id: s.id,
      channel: s.channel,
      title: active?.name ?? CHANNEL_TITLE[s.channel],
      subject: active?.subject ?? undefined,
      preview,
      body,
      templateParentId: s.template_parent_id,
      delayDays: Math.round(s.delay_hours / 24),
      conditionKind,
      variables: extractVars(body),
      validation: s.channel === 'letter',
      eligible: stat.enrolled,
      sent: i === 0 ? stat.sent : Math.max(0, stat.sent - i),
      replied: i === stepRows.length - 1 ? stat.replies : 0,
    };
  });

  const minScore = (campaign.entry_rules as { min_score?: number } | null)?.min_score;
  const detail: CampaignDetail = {
    id: campaign.id,
    name: campaign.name,
    status: (['active', 'paused', 'draft'].includes(campaign.status) ? campaign.status : 'draft') as CampaignDetail['status'],
    total: stat.enrolled,
    contacted: stat.contacted,
    sent: stat.sent,
    replies: stat.replies,
    positives: stat.accepted,
    acceptanceRate: stat.invites > 0 ? Math.round((stat.accepted / stat.invites) * 1000) / 10 : 0,
    replyRate: stat.sent > 0 ? Math.round((stat.replies / stat.sent) * 1000) / 10 : 0,
    createdDaysAgo: daysAgo(campaign.created_at),
    nextSendIn: '—',
    cadencePerDay: campaign.daily_cap ?? 0,
    qualif: minScore ? [`Score ≥ ${minScore}`] : [],
    steps,
    repliedContacts: [],
    avatarOverflow: Math.max(0, stat.contacted - 5),
    templateFamilies,
  };

  // File d'approbation de CETTE campagne (onglet « File d'attente »).
  const approvalRows =
    ((
      await supabase!
        .from('actions')
        .select('id,channel,block_reason,enrollments!inner(campaign_id,contacts(first_name,last_name,accounts(name)))')
        .eq('organization_id', campaign.organization_id)
        .eq('status', 'pending_approval')
        .eq('enrollments.campaign_id', id)
    ).data as
      | {
          id: string;
          channel: string;
          block_reason: string | null;
          enrollments: { contacts: { first_name: string | null; last_name: string | null; accounts: { name: string | null } | null } | null } | null;
        }[]
      | null) ?? [];
  const pendingApprovals = approvalRows.map((a) => ({
    id: a.id,
    channel: a.channel,
    contact: `${a.enrollments?.contacts?.first_name ?? ''} ${a.enrollments?.contacts?.last_name ?? ''}`.trim() || '—',
    company: a.enrollments?.contacts?.accounts?.name ?? '—',
    campaign: campaign.name,
    reason: a.block_reason,
  }));

  return (
    <div className="rs-shell">
      <AppTopBar active="campaigns" />
      <main className="rs-main">
        <CampaignDetailView detail={detail} pendingApprovals={pendingApprovals} orgId={campaign.organization_id} />
      </main>
    </div>
  );
}
