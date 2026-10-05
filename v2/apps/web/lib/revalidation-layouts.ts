import { revalidatePath } from 'next/cache';

/**
 * Sans `window.location.reload()` ni `router.refresh()`, une Server Action
 * n'actualise un LAYOUT que si elle le revalide : `revalidatePath('/campaigns/x')`
 * vise la page, pas les layouts qui l'enveloppent. Ces deux helpers nomment les
 * deux layouts qui affichent des données modifiées par des actions ; chaque
 * action n'appelle que celui dont elle change réellement une donnée.
 */

/**
 * Layout de la barre latérale (`app/(app)/layout.tsx` → `Coquille`) : badge
 * « à traiter » de la Réception, jauge « partis / en file / plafond »
 * (actions du jour, quotas des boîtes actives), carte Moteur, fuseau.
 */
export function revaliderCoquille(): void {
  revalidatePath('/', 'layout');
}

/**
 * Layout d'une campagne (`campaigns/[id]/layout.tsx`) : en-tête (nom, statut,
 * boîtes d'envoi, bouton Lancer/Pause) et compteurs des onglets (Contacts,
 * File du jour, Sources). `campagneId` peut être le motif `'[id]'` quand
 * l'action ne connaît pas la campagne.
 */
export function revaliderLayoutCampagne(campagneId: string): void {
  revalidatePath(`/campaigns/${campagneId}`, 'layout');
}
