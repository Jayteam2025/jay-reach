import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EtapeVue } from '@jay-reach/core';
import { avertissementsSequence, type CleAvertissementSequence, type EtapePourAvertissement } from './avertissements-sequence';

// Le canal est typé par `EtapePourAvertissement`, lui-même dérivé de `EtapeVue` : une valeur
// que `lireSequence` ne produit pas ne compile pas. C'est ce garde-fou qui manquait.
const etape = (
  position: number,
  canalDetaille: EtapePourAvertissement['canalDetaille'],
  corps = '',
): EtapePourAvertissement => ({ position, canalDetaille, corps });

describe('avertissementsSequence', () => {
  it('une invitation puis un message : rien à signaler', () => {
    expect(avertissementsSequence([etape(1, 'linkedin_invite'), etape(2, 'linkedin_message')])).toEqual([]);
  });

  it('un message LinkedIn sans invitation avant lui est signalé, à sa position', () => {
    expect(avertissementsSequence([etape(1, 'email'), etape(2, 'linkedin_message')])).toEqual([
      { cle: 'messageSansInvitation', position: 2 },
    ]);
  });

  // L'invitation APRÈS le message ne sauve pas le message : il part avant qu'elle existe.
  it('une invitation placée après le message ne compte pas', () => {
    expect(avertissementsSequence([etape(1, 'linkedin_message'), etape(2, 'linkedin_invite')])).toEqual([
      { cle: 'messageSansInvitation', position: 1 },
    ]);
  });

  it('les positions désordonnées sont remises dans l ordre de la séquence', () => {
    expect(avertissementsSequence([etape(5, 'linkedin_message'), etape(2, 'linkedin_invite')])).toEqual([]);
  });

  it('une invitation qui porte une note est signalée : l envoi serveur ne sait pas la porter', () => {
    expect(avertissementsSequence([etape(1, 'linkedin_invite', 'Bonjour, on se connecte ?')])).toEqual([
      { cle: 'noteDInvitation', position: 1 },
    ]);
  });

  it('une note faite d espaces ne compte pas pour une note', () => {
    expect(avertissementsSequence([etape(1, 'linkedin_invite', '   \n ')])).toEqual([]);
  });

  // Une invitation AVANT le message lève l'orphelin, même si elle porte une note : les deux
  // empêchements sont indépendants, et il ne faut pas que l'un masque l'autre.
  it('une invitation avec note avant le message ne signale QUE la note', () => {
    expect(
      avertissementsSequence([etape(1, 'linkedin_invite', 'Ravi de vous lire'), etape(2, 'linkedin_message')]),
    ).toEqual([{ cle: 'noteDInvitation', position: 1 }]);
  });

  it('les deux empêchements à la fois, dans l ordre de la séquence', () => {
    expect(
      avertissementsSequence([etape(1, 'linkedin_message'), etape(2, 'linkedin_invite', 'Ravi de vous lire')]),
    ).toEqual([
      { cle: 'messageSansInvitation', position: 1 },
      { cle: 'noteDInvitation', position: 2 },
    ]);
  });

  it('un corps sur une étape email ne déclenche rien', () => {
    expect(avertissementsSequence([etape(1, 'email', 'Bonjour {{prenom}}')])).toEqual([]);
  });

  it('seule la PREMIÈRE étape fautive est nommée, pour ne pas répéter le même avertissement', () => {
    const r = avertissementsSequence([etape(1, 'linkedin_message'), etape(2, 'linkedin_message')]);
    expect(r).toEqual([{ cle: 'messageSansInvitation', position: 1 }]);
  });
});

// Interface en trois langues : une clé posée dans une seule laisse l'écran afficher son
// identifiant brut aux deux autres. On vérifie les trois, pas seulement le français.
describe('clés de traduction des avertissements', () => {
  const LANGUES = ['fr', 'en', 'nl'] as const;
  const CLES: CleAvertissementSequence[] = ['messageSansInvitation', 'noteDInvitation'];

  it.each(LANGUES)('%s : chaque avertissement a son texte, et il nomme l étape', (langue) => {
    const messages = JSON.parse(
      readFileSync(join(__dirname, `../../../../packages/i18n/src/messages/${langue}.json`), 'utf8'),
    ) as { campagne?: { sequence?: { avertissements?: Record<string, string | undefined> } } };
    const avertissements = messages.campagne?.sequence?.avertissements ?? {};
    for (const cle of CLES) {
      const texte = avertissements[cle];
      expect(typeof texte, `${langue} > ${cle}`).toBe('string');
      // Sans le paramètre, l'opérateur lit un reproche sans savoir quelle étape ouvrir.
      expect(String(texte), `${langue} > ${cle} doit nommer l'étape`).toContain('{n}');
    }
  });
});

// Le test qui manquait, et dont l'absence a laissé les deux avertissements muets en production :
// il part d'une `EtapeVue` COMPLÈTE, telle que `lireSequence` la rend, au lieu d'une fixture
// réduite écrite à la main. Si la forme change, ceci cesse de compiler.
describe('sur la forme que lireSequence rend réellement', () => {
  const etapeReelle = (position: number, canalDetaille: EtapeVue['canalDetaille'], corps: string): EtapeVue => ({
    id: `etape-${position}`,
    position,
    canal: canalDetaille === 'email' ? 'email' : 'linkedin',
    canalDetaille,
    titre: 'Étape',
    sujet: null,
    corps,
    delaiHeures: 48,
    passes: 0,
    repondusIci: { total: 0, contacts: [] },
  });

  it('un message LinkedIn sans invitation est bien signalé', () => {
    expect(avertissementsSequence([etapeReelle(1, 'email', 'Bonjour'), etapeReelle(2, 'linkedin_message', 'Suite')])).toEqual([
      { cle: 'messageSansInvitation', position: 2 },
    ]);
  });

  it('une invitation qui porte sa note est bien signalée', () => {
    expect(avertissementsSequence([etapeReelle(1, 'linkedin_invite', 'On se connecte ?')])).toEqual([
      { cle: 'noteDInvitation', position: 1 },
    ]);
  });

  it('une séquence saine ne déclenche rien', () => {
    expect(
      avertissementsSequence([etapeReelle(1, 'linkedin_invite', ''), etapeReelle(2, 'linkedin_message', 'Suite')]),
    ).toEqual([]);
  });
});
