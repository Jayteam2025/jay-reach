import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lire = (n: string) => readFileSync(new URL(`../../../../supabase/migrations/${n}`, import.meta.url), 'utf8');

describe('migrations du lot 2', () => {
  it('sont additives et posent RLS', () => {
    for (const n of ['20260915100000_reglages_organisation.sql', '20260915100100_fils_traites_interet.sql', '20260915100200_notes_contact.sql', '20260915100300_photos_et_logos.sql']) {
      const sql = lire(n).toLowerCase();
      expect(sql).not.toMatch(/drop (table|column)/);
      if (sql.includes('create table')) expect(sql).toMatch(/enable row level security/);
    }
  });
});
