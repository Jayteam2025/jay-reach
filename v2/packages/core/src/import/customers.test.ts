import { describe, expect, it } from 'vitest';
import { parseCsv } from './parse.js';
import { suggestMapping } from './mapping.js';
import { applyMapping, processImport } from './pipeline.js';

/**
 * Une liste de clients ne contient que des entreprises : ni nom de personne, ni
 * adresse. Le pipeline d'import de CONTACTS rejette précisément ces lignes-là,
 * ce qui rendait l'import de clients inopérant pour son unique cas d'usage.
 *
 * Ces tests figent la distinction : `processImport` valide des contacts,
 * `applyMapping` se contente de traduire les colonnes.
 */
describe('import de clients (entreprises seules)', () => {
  const csv =
    'entreprise,siren,domaine\n' +
    'Exemple Industrie,,exemple-import.test\n' +
    'Client Inexistant SA,123456789,client-inexistant.test\n';

  it('reconnaît les colonnes entreprise, siren et domaine', () => {
    const mapping = suggestMapping(parseCsv(csv).headers);
    expect(mapping).toMatchObject({ entreprise: 'company', siren: 'siren', domaine: 'website' });
  });

  it("le pipeline de contacts rejette toutes les lignes, c'était la cause du bug", () => {
    const parsed = parseCsv(csv);
    const sortie = processImport(parsed, suggestMapping(parsed.headers));
    expect(sortie.rows).toHaveLength(0);
    expect(sortie.report.rowsRejected).toBe(2);
  });

  it('la correspondance seule conserve les deux entreprises', () => {
    const parsed = parseCsv(csv);
    const lignes = applyMapping(parsed, suggestMapping(parsed.headers));
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toMatchObject({ company: 'Exemple Industrie', website: 'exemple-import.test' });
    expect(lignes[1]).toMatchObject({ company: 'Client Inexistant SA', siren: '123456789' });
  });
});
