/** Trois langues dès le premier écran (règle CLAUDE.md). */
export const locales = ['fr', 'en', 'nl'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'fr';

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export async function getMessages(locale: Locale): Promise<Record<string, unknown>> {
  const mod = await import(`./messages/${locale}.json`, { with: { type: 'json' } });
  return mod.default as Record<string, unknown>;
}
