import { describe, expect, it } from 'vitest';
import { detectSeparator, parseCsv } from './parse.js';
import { suggestMapping } from './mapping.js';
import { dedupeRows, normalizeLinkedin, processImport, type MappedRow } from './pipeline.js';

describe('parse CSV', () => {
  it('détecte le séparateur point-virgule', () => {
    expect(detectSeparator('a;b;c\n1;2;3')).toBe(';');
  });

  it('gère les guillemets et un séparateur à l’intérieur d’un champ', () => {
    const parsed = parseCsv('name,note\n"Doe, John","a ""quote"""');
    expect(parsed.rows[0]).toEqual({ name: 'Doe, John', note: 'a "quote"' });
  });
});

describe('mapping multilingue', () => {
  it('mappe FR/EN/NL vers les champs canoniques et ignore l’inconnu', () => {
    const mapping = suggestMapping(['Prénom', 'Last name', 'E-mail', 'Société', 'colonne inconnue']);
    expect(mapping['Prénom']).toBe('first_name');
    expect(mapping['Last name']).toBe('last_name');
    expect(mapping['E-mail']).toBe('email');
    expect(mapping['Société']).toBe('company');
    expect(mapping['colonne inconnue']).toBeUndefined();
  });
});

describe('validation + déduplication + compte rendu', () => {
  it('rejette une ligne sans nom ni email', () => {
    const parsed = parseCsv('first_name,email\n,\nAlice,alice@x.fr');
    const out = processImport(parsed, suggestMapping(parsed.headers));
    expect(out.report.rowsRejected).toBe(1);
    expect(out.report.rowsUnique).toBe(1);
  });

  it('déduplique par email (insensible à la casse) et complète sans écraser', () => {
    const rows: MappedRow[] = [
      { raw: {}, email: 'a@x.fr', first_name: 'Alice' },
      { raw: {}, email: 'A@X.FR', last_name: 'Martin', first_name: 'Ignoré' },
    ];
    const { unique, merged } = dedupeRows(rows);
    expect(merged).toBe(1);
    expect(unique).toHaveLength(1);
    expect(unique[0]).toMatchObject({ first_name: 'Alice', last_name: 'Martin' });
  });

  it('déduplique par LinkedIn normalisé, puis par nom+entreprise', () => {
    expect(normalizeLinkedin('https://www.linkedin.com/in/jdoe/')).toBe('linkedin.com/in/jdoe');
    const rows: MappedRow[] = [
      { raw: {}, linkedin_url: 'https://linkedin.com/in/jdoe' },
      { raw: {}, linkedin_url: 'http://www.linkedin.com/in/jdoe/' },
      { raw: {}, first_name: 'Bob', company: 'Acme' },
      { raw: {}, first_name: 'Bob', company: 'Acme' },
    ];
    const { unique, merged } = dedupeRows(rows);
    expect(merged).toBe(2);
    expect(unique).toHaveLength(2);
  });
});
