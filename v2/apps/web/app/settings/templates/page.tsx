import { createClientOrNull } from '../../../lib/supabase/server';
import { AppTopBar } from '../../chrome';
import { TemplatesBoard } from './templates-board';
import { groupFamilies, type TemplateRow } from './families';

const COLS = 'id, parent_id, name, channel, locale, version, subject, body, sent_count, is_active';

export default async function TemplatesPage() {
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';
  const rows = supabase
    ? (
        await supabase
          .from('message_templates')
          .select(COLS)
          // La bibliothèque ne montre que ce qu'on y a versé : un message écrit
          // dans une étape de campagne appartient à sa campagne, et remplirait
          // cette liste de brouillons dès la première séquence rédigée.
          .eq('origin', 'library')
          .order('version', { ascending: true })
      ).data
    : null;
  const demo = !supabase;
  const families = groupFamilies((rows ?? []) as unknown as TemplateRow[]);

  return (
    <div className="rs-shell">
      <AppTopBar active="templates" />
      <main className="rs-main">
        <TemplatesBoard families={families} orgId={orgId} demo={demo} />
      </main>
    </div>
  );
}
