import { describe, expect, it } from 'vitest';
import {
  ErreurMessagerie,
  QUERY_ID_CONVERSATIONS,
  analyserConversations,
  urlConversations,
} from './messagerie.js';

/**
 * Forme réduite de l'appel de l'extension gelée (`linkedin-inbox.js`), identifiants inventés :
 * `data.<messengerConversations…>.elements[]`, dernier message dans `messages.elements[0]`.
 * `groupChat` est le discriminant un-à-un ; sa présence n'est pas attestée par l'extension.
 */
const MOI = 'ACoAAmoimoimoi';
const LUI = 'ACoAAluiluilui';
const DEPUIS = new Date('2026-10-10T00:00:00Z');
const APRES = Date.parse('2026-10-15T10:00:00Z');

function conv(o: {
  id: string;
  de?: string;
  groupe?: boolean | undefined;
  activite?: number;
  texte?: string;
}) {
  return {
    entityUrn: `urn:li:msg_conversation:(urn:li:fsd_profile:${MOI},${o.id})`,
    lastActivityAt: o.activite ?? APRES,
    ...(o.groupe === undefined ? {} : { groupChat: o.groupe }),
    messages: {
      elements: [
        {
          entityUrn: `urn:li:msg_message:(urn:li:fsd_profile:${MOI},${o.id}-m)`,
          deliveredAt: o.activite ?? APRES,
          body: { text: o.texte ?? 'Bonjour' },
          sender: { hostIdentityUrn: `urn:li:fsd_profile:${o.de ?? LUI}` },
        },
      ],
    },
  };
}
const charge = (elements: unknown[], cle = 'messengerConversationsBySyncToken') =>
  JSON.stringify({ data: { [cle]: { elements } } });

describe('urlConversations', () => {
  it('reprend l’appel de l’extension', () => {
    const url = urlConversations(`urn:li:fsd_profile:${MOI}`, 20);
    expect(url).toContain('voyagerMessagingGraphQL/graphql');
    expect(url).toContain(`queryId=${QUERY_ID_CONVERSATIONS}`);
    expect(url).toContain(`variables=(mailboxUrn:${encodeURIComponent(`urn:li:fsd_profile:${MOI}`)},count:20)`);
  });
});

describe('analyserConversations', () => {
  it('retient un message entrant d’une conversation un-à-un', () => {
    const r = analyserConversations(charge([conv({ id: 'a', groupe: false, texte: 'Oui' })]), `urn:li:fsd_profile:${MOI}`, DEPUIS);
    expect(r.entrants).toHaveLength(1);
    expect(r.entrants[0]).toMatchObject({ expediteurUrn: LUI, texte: 'Oui', recuLe: new Date(APRES) });
    expect(r.entrants[0]?.messageUrn).toContain('a-m');
  });

  it('compare les identités après normalisation : l’URN complet et l’identifiant nu sont la même personne', () => {
    const nu = analyserConversations(charge([conv({ id: 'a', groupe: false, de: MOI })]), MOI, DEPUIS);
    const complet = analyserConversations(charge([conv({ id: 'a', groupe: false, de: MOI })]), `urn:li:fsd_profile:${MOI}`, DEPUIS);
    expect(nu.entrants).toHaveLength(0);
    expect(complet.entrants).toHaveLength(0);
  });

  it('ignore nos propres messages sans les compter comme écartés', () => {
    const r = analyserConversations(charge([conv({ id: 'a', groupe: false, de: MOI })]), MOI, DEPUIS);
    expect(r).toEqual({ entrants: [], ecartesNonUnAUn: 0, ecartesAnterieuresAuCurseur: 0 });
  });

  it('écarte et compte une conversation dont l’activité ne dépasse pas le curseur (bornes comprises)', () => {
    const r = analyserConversations(
      charge([
        conv({ id: 'egal', groupe: false, activite: DEPUIS.getTime() }),
        conv({ id: 'vieux', groupe: false, activite: DEPUIS.getTime() - 1 }),
        conv({ id: 'neuf', groupe: false, activite: DEPUIS.getTime() + 1 }),
      ]),
      MOI,
      DEPUIS,
    );
    expect(r.ecartesAnterieuresAuCurseur).toBe(2);
    expect(r.entrants).toHaveLength(1);
  });

  it('écarte et compte une conversation de groupe, sans la lire', () => {
    const r = analyserConversations(charge([conv({ id: 'g', groupe: true }), conv({ id: 'a', groupe: false })]), MOI, DEPUIS);
    expect(r.ecartesNonUnAUn).toBe(1);
    expect(r.entrants.map((m) => m.conversationUrn)).toEqual([expect.stringContaining(',a)')]);
  });

  it('une conversation sans discriminant n’est pas un-à-un par défaut', () => {
    const r = analyserConversations(charge([conv({ id: 'x' }), conv({ id: 'a', groupe: false })]), MOI, DEPUIS);
    expect(r.ecartesNonUnAUn).toBe(1);
    expect(r.entrants).toHaveLength(1);
  });

  it('un expéditeur qui n’est pas un membre (système, organisation) est écarté et compté', () => {
    const c = conv({ id: 's', groupe: false });
    c.messages.elements[0]!.sender.hostIdentityUrn = 'urn:li:fsd_company:123';
    const r = analyserConversations(charge([c, conv({ id: 'a', groupe: false })]), MOI, DEPUIS);
    expect(r.ecartesNonUnAUn).toBe(1);
    expect(r.entrants).toHaveLength(1);
  });

  it('une boîte réellement vide rend une relève vide, sans erreur', () => {
    expect(analyserConversations(charge([]), MOI, DEPUIS)).toEqual({
      entrants: [],
      ecartesNonUnAUn: 0,
      ecartesAnterieuresAuCurseur: 0,
    });
  });

  it('ne code pas en dur le nom du champ : tout champ préfixé messengerConversations est lu', () => {
    const r = analyserConversations(charge([conv({ id: 'a', groupe: false })], 'messengerConversationsAutreNom'), MOI, DEPUIS);
    expect(r.entrants).toHaveLength(1);
  });

  describe('une charge utile illisible lève une erreur nommée, jamais une relève vide', () => {
    const cas: Record<string, string> = {
      'pas du JSON': '<html>login</html>',
      'JSON non objet': '[]',
      'sans data': JSON.stringify({ errors: [{ message: 'queryId inconnu' }] }),
      'sans champ messengerConversations': JSON.stringify({ data: { autreChose: { elements: [] } } }),
      'elements absent': JSON.stringify({ data: { messengerConversationsX: {} } }),
      'elements non tableau': JSON.stringify({ data: { messengerConversationsX: { elements: {} } } }),
      'discriminant un-à-un introuvable partout': charge([conv({ id: 'a' }), conv({ id: 'b' })]),
    };
    for (const [nom, brut] of Object.entries(cas)) {
      it(nom, () => {
        let erreur: unknown;
        try {
          analyserConversations(brut, MOI, DEPUIS);
        } catch (e) {
          erreur = e;
        }
        expect(erreur).toBeInstanceOf(ErreurMessagerie);
        expect((erreur as ErreurMessagerie).code).toBe('IllisibleMessagerie');
        expect((erreur as ErreurMessagerie).name).toBe('IllisibleMessagerie');
      });
    }

    it('ne recopie jamais la charge utile dans le message', () => {
      expect(() => analyserConversations(charge([conv({ id: 'a', texte: 'SECRET-PRIVE' })]), MOI, DEPUIS)).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('SECRET-PRIVE') }),
      );
    });

    it('une identité de compte illisible lève aussi', () => {
      expect(() => analyserConversations(charge([]), 'undefined', DEPUIS)).toThrow(ErreurMessagerie);
    });

    it('un message entrant sans identifiant lève', () => {
      const c = conv({ id: 'a', groupe: false });
      delete (c.messages.elements[0] as { entityUrn?: string }).entityUrn;
      expect(() => analyserConversations(charge([c]), MOI, DEPUIS)).toThrow(ErreurMessagerie);
    });
  });
});
