import Image from 'next/image';
import Link from 'next/link';
import { CustomerDesk } from '@/components/CustomerDesk';

export const metadata = { title: 'Generate token · Tronic' };

/** The tenant token page on its own, for phones and for sharing as a link. */
export default function TokenPage() {
  return (
    <div className="token-page">
      <header>
        <Image src="/tronic-logo-white.png" alt="Tronic" width={667} height={148} priority />
        <span>Prepaid electricity</span>
      </header>
      <main>
        <CustomerDesk />
        <Link href="/login" className="token-staff">Landlord? Sign in here</Link>
      </main>
      <div className="radiate" aria-hidden="true"><i /><i /><i /></div>
    </div>
  );
}
