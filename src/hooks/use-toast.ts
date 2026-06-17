// Compat shadcn → sonner.
//
// Historiquement le repo avait DEUX systèmes de toast : sonner (monté dans App)
// et le toast shadcn (ce hook + un <Toaster> jamais monté). Résultat : tous les
// `useToast()` shadcn étaient des no-op silencieux. On garde l'API shadcn
// (`useToast().toast({...})` et `toast({...})`) mais on la délègue à sonner —
// le seul système réellement monté — pour que tous les toasts s'affichent.

import type { ReactNode } from 'react';
import { toast as sonnerToast } from 'sonner';

export interface ToastInput {
  title?: ReactNode;
  description?: ReactNode;
  variant?: 'default' | 'destructive';
  duration?: number;
}

function showToast({ title, description, variant, duration }: ToastInput = {}) {
  const hasBoth = title != null && description != null;
  const message = (title ?? description ?? '') as ReactNode;
  const opts = { duration, description: hasBoth ? description : undefined };
  const id = variant === 'destructive'
    ? sonnerToast.error(message, opts)
    : sonnerToast(message, opts);
  return { id, dismiss: () => sonnerToast.dismiss(id), update: () => { /* no-op */ } };
}

export function useToast() {
  return {
    toast: showToast,
    dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  };
}

export const toast = showToast;
