import { formatDate, formatToken, type Vend } from '@/lib/types';

/** 80 mm thermal receipt. Shown on screen and printed with the browser's print dialog. */
export function Receipt({ vend, reprint }: { vend: Vend; reprint?: boolean }) {
  const mock = vend.adapterMode === 'mock';
  return (
    <div className="receipt">
      <h3>TRONIC</h3>
      <div className="center">Electricity Token Receipt</div>
      {reprint && <div className="center">*** REPRINT ***</div>}
      {mock && <div className="watermark">MOCK – NOT VALID ON METERS</div>}
      <hr />
      <div className="line"><span>Date</span><span>{formatDate(vend.completedAt ?? vend.createdAt)}</span></div>
      <div className="line"><span>Receipt</span><span>{vend.reference.slice(0, 8).toUpperCase()}</span></div>
      {vend.vendorRef && <div className="line"><span>Vendor ref</span><span>{vend.vendorRef}</span></div>}
      <div className="line"><span>Operator</span><span>{vend.operator}</span></div>
      <div className="line"><span>Meter</span><span>{vend.meterNo}</span></div>
      <hr />
      <div className="line"><span>Units</span><span>{vend.units} kWh</span></div>
      {vend.lines.map((l) => (
        <div className="line" key={l.name}><span>{l.name}</span><span>{l.amount}</span></div>
      ))}
      <div className="line" style={{ fontWeight: 700 }}><span>TOTAL {vend.currency}</span><span>{vend.amount}</span></div>
      <hr />
      {(vend.tokens ?? []).map((t, i, all) => (
        <div key={i}>
          {all.length > 1 && <div className="center small">{i < all.length - 1 ? `Key change token ${i + 1} – enter first` : 'Credit token'}</div>}
          <div className="rtoken">{formatToken(t)}</div>
        </div>
      ))}
      <hr />
      <div className="small">
        Enter the token on the meter keypad and press Enter.<br />
        ACCEPT = credit added · USED = token already entered · OLD = token too old · FULL = meter credit limit reached, keep this token · REJECT = check the digits.
        <br />Keep this receipt. Tokens cannot be refunded.
      </div>
    </div>
  );
}
