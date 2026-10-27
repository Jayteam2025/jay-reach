import { describe, expect, it } from 'vitest';
import {
  ErreurMessagerie,
  QUERY_ID_CONVERSATIONS,
  analyserConversations,
  compteursDuReleve,
  urlConversations,
} from './messagerie.js';

/**
 * La fixture reproduit la FORME RÉELLE relevée sur le serveur (20 conversations), valeurs fictives :
 * racine `data.messengerConversationsBySyncToken = { metadata, elements }`, participants en TABLEAU
 * avec `participantType.member.profileUrl`, `sender` du message SANS `participantType` (d'où le
 * croisement avec les participants), texte sous `body.text`.
 */
const MOI = 'ACoAAmoimoimoi';
const LUI = 'ACoAAluiluilui';
const DEPUIS = new Date('2026-10-10T00:00:00Z');
const APRES = Date.parse('2026-10-15T10:00:00Z');
const urn = (id: string) => `urn:li:fsd_profile:${id}`;
const profil = (id: string) => `https://www.linkedin.com/in/profil-${id}`;

function participant(id: string) {
  return {
    hostIdentityUrn: urn(id),
    entityUrn: `urn:li:msg_messagingParticipant:${urn(id)}`,
    participantType: {
      member: {
        profileUrl: profil(id),
        firstName: { text: 'Prenom', attributes: [] },
        lastName: { text: 'Nom', attributes: [] },
        headline: { text: 'Poste fictif', attributes: [] },
      },
      agent: null,
      custom: null,
      organization: null,
    },
  };
}

type Conv = ReturnType<typeof conv>;
function conv(o: { id: string; de?: string; groupe?: boolean; activite?: number; texte?: string; extra?: string[] }) {
  const de = o.de ?? LUI;
  const autre = de === MOI ? LUI : MOI;
  const activite = o.activite ?? APRES;
  return {
    entityUrn: `urn:li:msg_conversation:(${urn(MOI)},${o.id})`,
    conversationParticipants: [de, autre, ...(o.extra ?? [])].map(participant),
    groupChat: o.groupe ?? false,
    lastActivityAt: activite,
    categories: ['PRIMARY_INBOX'],
    read: false,
    unreadCount: 1,
    createdAt: activite - 1000,
    lastReadAt: activite - 500,
    conversationUrl: `https://www.linkedin.com/messaging/thread/${o.id}/`,
    creator: participant(de),
    messages: {
      elements: [
        {
          entityUrn: `urn:li:msg_message:(${urn(MOI)},${o.id}-m)`,
          deliveredAt: activite,
          body: { text: o.texte ?? 'Bonjour', attributes: [] },
          sender: { hostIdentityUrn: urn(de), entityUrn: `urn:li:msg_messagingParticipant:${urn(de)}` },
          subject: null,
          renderContent: [],
          backendUrn: `urn:li:messagingMessage:${o.id}-m`,
          conversation: { entityUrn: `urn:li:msg_conversation:(${urn(MOI)},${o.id})` },
        },
      ],
    },
  };
}
const message = (c: Conv) => c.messages.elements[0]!;
const charge = (elements: unknown[], cle = 'messengerConversationsBySyncToken') =>
  JSON.stringify({ data: { [cle]: { metadata: { newSyncToken: 'jeton' }, elements } } });
const analyser = (elements: unknown[], moi: string = MOI) => analyserConversations(charge(elements), moi, DEPUIS);
const VIDE = {
  ecartesNonUnAUn: 0,
  ecartesAnterieuresAuCurseur: 0,
  unAUnSansIndice: 0,
  sansMessage: 0,
  expediteursIllisibles: 0,
  conversationsIllisibles: 0,
  sansHorodatage: 0,
  entrantsIllisibles: 0,
};

describe('urlConversations', () => {
  it('reprend l’appel de l’extension', () => {
    const url = urlConversations(urn(MOI), 20);
    expect(url).toContain('voyagerMessagingGraphQL/graphql');
    expect(url).toContain(`queryId=${QUERY_ID_CONVERSATIONS}`);
    expect(url).toContain(`variables=(mailboxUrn:${encodeURIComponent(urn(MOI))},count:20)`);
  });
});

describe('compteursDuReleve', () => {
  it('expose tous les compteurs', () => {
    expect(compteursDuReleve(analyser([conv({ id: 'g', groupe: true })]))).toEqual({ ...VIDE, ecartesNonUnAUn: 1 });
  });
});

describe('analyserConversations', () => {
  it('retient un message entrant de la forme réelle, sans aucun compteur levé', () => {
    const r = analyser([conv({ id: 'a', texte: 'Oui' })], urn(MOI));
    expect(r.entrants).toHaveLength(1);
    expect(r.entrants[0]).toMatchObject({ expediteurUrn: LUI, texte: 'Oui', recuLe: new Date(APRES) });
    expect(r.entrants[0]?.messageUrn).toContain('a-m');
    // Sur la forme réelle, groupChat ET participants sont lus : la branche « sans indice » reste vide.
    expect(compteursDuReleve(r)).toEqual(VIDE);
  });

  it('expose l’URL du profil de l’expéditeur, croisée avec le participant de même identité', () => {
    expect(analyser([conv({ id: 'a' })]).entrants[0]?.expediteurUrl).toBe(profil(LUI));
  });

  it('l’URL n’est pas celle d’un autre participant, même placé en premier', () => {
    const c = conv({ id: 'a' });
    c.conversationParticipants.reverse(); // moi d’abord, l’expéditeur ensuite
    expect(analyser([c]).entrants[0]?.expediteurUrl).toBe(profil(LUI));
  });

  it('URL null quand aucun participant ne correspond ou qu’elle manque', () => {
    const sans = conv({ id: 'a' });
    sans.conversationParticipants = [];
    expect(analyser([sans]).entrants[0]?.expediteurUrl).toBeNull();
    const vide = conv({ id: 'b' });
    delete (vide.conversationParticipants[0] as { participantType?: unknown }).participantType;
    expect(analyser([vide]).entrants[0]?.expediteurUrl).toBeNull();
  });

  it('compare les identités après normalisation : URN complet et identifiant nu sont la même personne', () => {
    expect(analyser([conv({ id: 'a', de: MOI })], MOI).entrants).toHaveLength(0);
    expect(analyser([conv({ id: 'a', de: MOI })], urn(MOI)).entrants).toHaveLength(0);
  });

  it('ignore nos propres messages sans les compter', () => {
    expect(compteursDuReleve(analyser([conv({ id: 'a', de: MOI })]))).toEqual(VIDE);
  });

  it('écarte et compte une conversation dont l’activité ne dépasse pas le curseur (bornes comprises)', () => {
    const r = analyser([
      conv({ id: 'egal', activite: DEPUIS.getTime() }),
      conv({ id: 'vieux', activite: DEPUIS.getTime() - 1 }),
      conv({ id: 'neuf', activite: DEPUIS.getTime() + 1 }),
    ]);
    expect(r.ecartesAnterieuresAuCurseur).toBe(2);
    expect(r.entrants).toHaveLength(1);
  });

  it('écarte et compte un groupe signalé par groupChat, même avec deux participants', () => {
    const r = analyser([conv({ id: 'g', groupe: true }), conv({ id: 'a' })]);
    expect(r.ecartesNonUnAUn).toBe(1);
    expect(r.entrants).toHaveLength(1);
  });

  it('écarte un groupe signalé par plus de deux participants, même sans groupChat', () => {
    const g = conv({ id: 'g', extra: ['ACoAAtroisieme'] });
    delete (g as { groupChat?: boolean }).groupChat;
    const r = analyser([g, conv({ id: 'a' })]);
    expect(r.ecartesNonUnAUn).toBe(1);
    expect(r.entrants).toHaveLength(1);
    expect(r.unAUnSansIndice).toBe(0);
  });

  it('sans aucun indice (ni groupChat ni participants), lue comme un-à-un et comptée à part', () => {
    const x = conv({ id: 'x' });
    delete (x as { groupChat?: boolean }).groupChat;
    delete (x as { conversationParticipants?: unknown }).conversationParticipants;
    const r = analyser([x, conv({ id: 'a' })]);
    expect(r.entrants).toHaveLength(2);
    expect(r.unAUnSansIndice).toBe(1);
    expect(r.ecartesNonUnAUn).toBe(0);
  });

  it('accepte des participants portés par { elements }', () => {
    const c = conv({ id: 'g', extra: ['ACoAAtroisieme'] });
    (c as { conversationParticipants: unknown }).conversationParticipants = { elements: c.conversationParticipants };
    delete (c as { groupChat?: boolean }).groupChat;
    expect(analyser([c]).ecartesNonUnAUn).toBe(1);
  });

  it('une conversation sans lastActivityAt est traitée et comptée, pas perdue', () => {
    const c = conv({ id: 'a' });
    delete (c as { lastActivityAt?: number }).lastActivityAt;
    const r = analyser([c]);
    expect(r.entrants).toHaveLength(1);
    expect(r.sansHorodatage).toBe(1);
  });

  it('un élément qui n’est pas un objet a son propre compteur, pas celui des groupes', () => {
    const r = analyser(['intrus', null, conv({ id: 'a' })]);
    expect(r.conversationsIllisibles).toBe(2);
    expect(r.ecartesNonUnAUn).toBe(0);
    expect(r.entrants).toHaveLength(1);
  });

  it('rend un texte vide tel quel : une pièce jointe seule reste une réponse', () => {
    const r = analyser([conv({ id: 'a', texte: '' })]);
    expect(r.entrants).toHaveLength(1);
    expect(r.entrants[0]?.texte).toBe('');
  });

  it('un message entrant sans identifiant est compté, il ne lève pas et n’emporte pas les autres', () => {
    const biscornu = conv({ id: 'b' });
    delete (message(biscornu) as { entityUrn?: string }).entityUrn;
    const r = analyser([biscornu, conv({ id: 'a' })]);
    expect(r.entrants).toHaveLength(1);
    expect(r.entrants[0]?.messageUrn).toContain('a-m');
    expect(r.entrantsIllisibles).toBe(1);
  });

  it('un message sans date ni lastActivityAt est compté', () => {
    const c = conv({ id: 'b' });
    delete (c as { lastActivityAt?: number }).lastActivityAt;
    delete (message(c) as { deliveredAt?: number }).deliveredAt;
    expect(analyser([c]).entrantsIllisibles).toBe(1);
  });

  it('une boîte réellement vide rend une relève vide, sans erreur', () => {
    expect(analyser([])).toEqual({ ...VIDE, entrants: [] });
  });

  it('ne code pas en dur le nom du champ : tout champ préfixé messengerConversations est lu', () => {
    const r = analyserConversations(charge([conv({ id: 'a' })], 'messengerConversationsAutreNom'), MOI, DEPUIS);
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
      expect(() => analyserConversations('{"data":{"x":"SECRET-PRIVE"}}', MOI, DEPUIS)).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('SECRET-PRIVE') }),
      );
    });

    it('une identité de compte illisible lève aussi', () => {
      expect(() => analyser([], 'undefined')).toThrow(ErreurMessagerie);
    });
  });

  describe('garde de volume : une dérive de forme ne rend pas une relève vide en silence', () => {
    const sansMessage = (id: string) => {
      const c = conv({ id, texte: 'SECRET-PRIVE' });
      (c as { messages?: unknown }).messages = { elements: [] };
      return c;
    };
    const expediteurInconnu = (id: string) => {
      const c = conv({ id, texte: 'SECRET-PRIVE' });
      message(c).sender.hostIdentityUrn = `urn:li:autre_format:${id}`;
      return c;
    };

    it('lève quand trois conversations lues sont toutes sans message', () => {
      expect(() => analyser([sansMessage('1'), sansMessage('2'), sansMessage('3')])).toThrow(ErreurMessagerie);
    });

    it('lève quand trois conversations lues ont toutes un format d’expéditeur inconnu', () => {
      expect(() => analyser([expediteurInconnu('1'), expediteurInconnu('2'), expediteurInconnu('3')])).toThrow(ErreurMessagerie);
    });

    it('lève sur un mélange des deux cas de dérive', () => {
      expect(() => analyser([sansMessage('1'), expediteurInconnu('2'), sansMessage('3')])).toThrow(ErreurMessagerie);
    });

    const sansIdentifiant = (id: string) => {
      const c = conv({ id, texte: 'SECRET-PRIVE' });
      delete (message(c) as { entityUrn?: string }).entityUrn;
      return c;
    };

    it('lève quand trois conversations ont toutes un message entrant sans entityUrn', () => {
      expect(() => analyser([sansIdentifiant('1'), sansIdentifiant('2'), sansIdentifiant('3')])).toThrow(ErreurMessagerie);
    });

    it('lève quand trois éléments de la liste ne sont pas des objets', () => {
      expect(() => analyser(['a', 'b', 'c'])).toThrow(ErreurMessagerie);
    });

    it('trois messages sans entityUrn mais un message valide : ne lève pas', () => {
      const r = analyser([sansIdentifiant('1'), sansIdentifiant('2'), sansIdentifiant('3'), conv({ id: 'ok' })]);
      expect(r.entrants).toHaveLength(1);
      expect(r.entrantsIllisibles).toBe(3);
    });

    it('ne cite pas la charge dans le message', () => {
      expect(() => analyser([sansMessage('1'), sansMessage('2'), sansMessage('3')])).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('SECRET-PRIVE') }),
      );
    });

    it('une seule conversation sans message : compte sans lever (sous le seuil de 3)', () => {
      const r = analyser([sansMessage('1')]);
      expect(r.sansMessage).toBe(1);
      expect(r.entrants).toHaveLength(0);
    });

    it('deux sans message : compte sans lever', () => {
      expect(analyser([sansMessage('1'), sansMessage('2')]).sansMessage).toBe(2);
    });

    it('un mélange avec une conversation valide ne lève pas', () => {
      const r = analyser([sansMessage('1'), expediteurInconnu('2'), sansMessage('3'), conv({ id: 'ok' })]);
      expect(r.entrants).toHaveLength(1);
      expect(r.sansMessage).toBe(2);
      expect(r.expediteursIllisibles).toBe(1);
    });

    it('trois conversations sortantes (nos messages) ne sont pas une dérive', () => {
      const r = analyser([conv({ id: '1', de: MOI }), conv({ id: '2', de: MOI }), conv({ id: '3', de: MOI })]);
      expect(r.entrants).toHaveLength(0);
    });

    it('des sans message avec une conversation sortante ne sont pas une dérive : tout n’est pas de la dérive', () => {
      const r = analyser([sansMessage('1'), sansMessage('2'), sansMessage('3'), conv({ id: 'out', de: MOI })]);
      expect(r.sansMessage).toBe(3);
    });

    it('le volume lu exclut les anciennes conversations : deux sans message et une ancienne ne lèvent pas', () => {
      const vieux = { ...sansMessage('v'), lastActivityAt: DEPUIS.getTime() - 1 };
      expect(analyser([sansMessage('1'), sansMessage('2'), vieux]).sansMessage).toBe(2);
    });

    it('les anciennes conversations et les groupes ne comptent pas dans le volume lu', () => {
      const vieux = (id: string) => ({ ...sansMessage(id), lastActivityAt: DEPUIS.getTime() - 1 });
      const groupe = (id: string) => ({ ...sansMessage(id), groupChat: true });
      const r = analyser([vieux('1'), vieux('2'), groupe('3'), sansMessage('4'), sansMessage('5')]);
      expect(r.sansMessage).toBe(2);
    });
  });
});
