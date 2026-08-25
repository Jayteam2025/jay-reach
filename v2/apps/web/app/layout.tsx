import './globals.css';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { body, display, mono } from './fonts';

export const metadata = {
  title: 'Jay Reach',
  description: 'Moteur de prospection multicanale, self-hosted.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
