import type { Metadata } from 'next';
import { IBM_Plex_Mono, Montserrat, Poppins } from 'next/font/google';
import './globals.css';

// Poppins for text, Montserrat (as on tronic.co.ke) for headings and figures.
const sans = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });
const display = Montserrat({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-display', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Tronic Token Desk',
  description: 'Tronic STS electricity token portal for authorised agents',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
