import { NextResponse } from 'next/server';
import { exporterCsv, ForbiddenError, ErreurEntree } from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';

export const dynamic = 'force-dynamic';

/**
 * Export CSV de l'onglet « Tous les contacts » (spec §6.11) — lien direct
 * (`<a href>`), pas une Server Action : un téléchargement de fichier a besoin
 * d'une vraie réponse HTTP avec `Content-Disposition`, qu'une Server Action ne
 * produit pas. Mêmes filtres que la page (`?etat=&campagne=&email=&source=&q=`),
 * lus dans l'URL de la requête plutôt que dans `searchParams` (route handler,
 * pas une page).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sp = url.searchParams;

  const ctx = await contexteCourant();
  try {
    const csv = await exporterCsv(ctx, {
      filtre: sp.get('etat') ?? undefined,
      campagneId: sp.get('campagne') ?? undefined,
      email: sp.get('email') ?? undefined,
      source: sp.get('source') ?? undefined,
      recherche: sp.get('q') ?? undefined,
    });
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="contacts.csv"',
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: 'Droit insuffisant.' }, { status: 403 });
    if (err instanceof ErreurEntree) return NextResponse.json({ error: 'Filtres invalides.' }, { status: 400 });
    throw err;
  }
}
