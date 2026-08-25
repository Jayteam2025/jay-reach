import { describe, expect, it } from 'vitest';
import { parseSmartleadEvent, isActionableSmartleadEvent } from './smartlead-events.js';

describe('parse des événements Smartlead', () => {
  it('normalise une réponse (LEAD_REPLIED)', () => {
    const e = parseSmartleadEvent({
      event_type: 'LEAD_REPLIED',
      campaign_id: 12345,
      to_email: 'Jean.Test@Example.com',
      reply_message: { text: 'Merci, rappelez-moi.' },
      message_id: 'm-1',
    });
    expect('error' in e).toBe(false);
    if ('error' in e) return;
    expect(e.type).toBe('replied');
    expect(e.email).toBe('jean.test@example.com'); // minuscule
    expect(e.campaignId).toBe('12345');
    expect(e.replyText).toBe('Merci, rappelez-moi.');
  });

  it('reconnaît bounce et unsubscribe sous des noms variés', () => {
    expect((parseSmartleadEvent({ event_type: 'EMAIL_BOUNCE', lead_email: 'a@b.co' }) as { type: string }).type).toBe('bounced');
    expect((parseSmartleadEvent({ event: 'LEAD_UNSUBSCRIBED', email: 'a@b.co' }) as { type: string }).type).toBe('unsubscribed');
    expect((parseSmartleadEvent({ event_type: 'EMAIL_OPEN', to_email: 'a@b.co' }) as { type: string }).type).toBe('opened');
  });

  it('type inconnu → unknown, sans planter', () => {
    expect((parseSmartleadEvent({ event_type: 'WHATEVER' }) as { type: string }).type).toBe('unknown');
  });

  it('refuse un payload non-objet', () => {
    expect('error' in parseSmartleadEvent(null)).toBe(true);
    expect('error' in parseSmartleadEvent('nope')).toBe(true);
  });

  it('distingue les événements actionnables', () => {
    expect(isActionableSmartleadEvent('replied')).toBe(true);
    expect(isActionableSmartleadEvent('bounced')).toBe(true);
    expect(isActionableSmartleadEvent('unsubscribed')).toBe(true);
    expect(isActionableSmartleadEvent('opened')).toBe(false);
    expect(isActionableSmartleadEvent('sent')).toBe(false);
  });
});
