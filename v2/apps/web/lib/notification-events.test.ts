import { describe, expect, it } from 'vitest';
import {
  CATALOGUE_EVENEMENTS_NOTIFICATION,
  DEFAUT_ACTIF_NOTIFICATION,
  EVENEMENTS_NOTIFICATION_ACTIFS,
} from './notification-events';

describe('catalogue des notifications', () => {
  it('linkedin.session_blocked est au catalogue et actif', () => {
    expect(CATALOGUE_EVENEMENTS_NOTIFICATION).toContain('linkedin.session_blocked');
    expect(EVENEMENTS_NOTIFICATION_ACTIFS).toContain('linkedin.session_blocked');
    expect(DEFAUT_ACTIF_NOTIFICATION['linkedin.session_blocked']).toBe(true);
  });

  it('linkedin.reponse_echouee est au catalogue et actif (produit par reponse-manuelle)', () => {
    expect(CATALOGUE_EVENEMENTS_NOTIFICATION).toContain('linkedin.reponse_echouee');
    expect(EVENEMENTS_NOTIFICATION_ACTIFS).toContain('linkedin.reponse_echouee');
    expect(DEFAUT_ACTIF_NOTIFICATION['linkedin.reponse_echouee']).toBe(true);
  });
});
