/**
 * `lireAujourdhui` mémoïsé pour la durée d'un rendu RSC : la coquille (carte
 * Moteur, badge Réception, jauge d'envois) et la page Aujourd'hui appellent la
 * même fonction avec le même `Contexte` (lui-même mémoïsé par
 * `contexteCourant`) — sans ce cache, chaque navigation relirait deux fois les
 * mêmes requêtes. La mémoïsation (React `cache`) reste ici : `packages/core`
 * ne dépend pas de React, ses fonctions doivent rester appelables telles
 * quelles par le futur serveur MCP.
 */
import { cache } from 'react';
import { lireAujourdhui, type Contexte } from '@jay-reach/core';

export const lireAujourdhuiCourant = cache((ctx: Contexte) => lireAujourdhui(ctx));
