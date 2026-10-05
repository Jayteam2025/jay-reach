import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * La coquille entoure CHAQUE page : y appeler `lireAujourdhui` (≈ 15 requêtes, dont la liste
 * de tous les fils à traiter) refaisait le calcul de l'accueil à chaque navigation, et
 * retardait le squelette `loading.tsx` qui vit sous ce layout. Garde de source : un retour à
 * cette lecture fait rougir ce test. Idem pour les deux menus déroulants de filtre, qui
 * n'ont pas besoin de la tendance sur 7 jours de `listerCampagnes`.
 */
const lire = (relatif: string) => readFileSync(join(__dirname, '../..', relatif), 'utf8');

describe('lectures légères (coquille et menus déroulants)', () => {
  it("la coquille lit lireResumeCoquilleCourant, pas l'accueil complet", () => {
    const src = lire('components/coquille/Coquille.tsx');
    expect(src).toContain('lireResumeCoquilleCourant');
    expect(src).not.toContain('lireAujourdhui');
  });

  it.each(['app/(app)/contacts/page.tsx', 'app/(app)/inbox/page.tsx'])('%s remplit son filtre avec listerCampagnesPourFiltre', (page) => {
    const src = lire(page);
    expect(src).toContain('listerCampagnesPourFiltre(ctx)');
    expect(src).not.toMatch(/\blisterCampagnes\(/);
  });
});
