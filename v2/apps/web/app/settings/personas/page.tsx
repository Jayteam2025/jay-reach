import { createClientOrNull } from '../../../lib/supabase/server';
import { AppTopBar } from '../../chrome';
import { PersonaBoard } from './persona-board';
import { SAMPLE_PERSONAS, type Persona } from '../../../lib/sample-personas';

const COLS = 'id, name, description, title_patterns, title_exclusions, seniority, channels_priority, scoring_prompt, is_active';

export default async function PersonasPage() {
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';
  const data = supabase ? (await supabase.from('personas').select(COLS)).data : null;

  // Sans Supabase : mode démo (personas d'exemple, lecture seule). Avec Supabase :
  // les vrais personas (liste éventuellement vide), jamais de faux.
  const demo = !supabase;
  const personas: Persona[] = demo ? [...SAMPLE_PERSONAS] : ((data ?? []) as unknown as Persona[]);

  return (
    <div className="rs-shell">
      <AppTopBar active="personas" />
      <main className="rs-main">
        <PersonaBoard personas={personas} orgId={orgId} demo={demo} />
      </main>
    </div>
  );
}
