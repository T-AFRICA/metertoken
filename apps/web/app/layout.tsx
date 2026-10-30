import type { Metadata } from 'next';
import { IBM_Plex_Mono, Instrument_Serif, Nunito_Sans } from 'next/font/google';
import './globals.css';

// Nunito Sans matches tronic.co.ke; the serif carries headings and figures.
const sans = Nunito_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-serif', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Tronic Token Desk',
  description: 'Tronic STS electricity token portal for authorised agents',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
