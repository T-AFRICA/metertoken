import { Icon, type IconName } from './Icon';

export interface Bar {
  label: string;
  value: number;
  /** Shown on hover, e.g. "14:00 · 3 tokens". */
  tip: string;
}

/** A single-series bar strip: muted bars with the latest one in red. */
export function Bars({ bars, height = 36, labelEvery = 0 }: { bars: Bar[]; height?: number; labelEvery?: number }) {
  const max = Math.max(...bars.map((b) => b.value), 0);
  return (
    <div className="bars" style={{ height }} role="img" aria-label={bars.map((b) => b.tip).join(', ')}>
      {bars.map((b, i) => (
        <div key={i} className={`bar ${i === bars.length - 1 ? 'now' : ''}`} data-tip={b.tip}>
          <span style={{ height: max ? `${Math.max((b.value / max) * 100, b.value ? 6 : 0)}%` : 0 }} />
          {labelEvery > 0 && i % labelEvery === 0 && <em>{b.label}</em>}
        </div>
      ))}
    </div>
  );
}

export function Stat({
  icon,
  label,
  value,
  prefix,
  suffix,
  note,
  tone,
  trend,
}: {
  icon: IconName;
  label: string;
  value: React.ReactNode;
  prefix?: string;
  suffix?: string;
  note?: React.ReactNode;
  tone?: 'warn' | 'ok';
  trend?: Bar[];
}) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="k">
        <Icon name={icon} size={28} />
        <span>{label}</span>
      </div>
      <div className="v">
        {prefix && <small>{prefix}</small>}
        {value}
        {suffix && <small>{suffix}</small>}
      </div>
      {trend && trend.length > 0 && <Bars bars={trend} />}
      {note && <div className="note">{note}</div>}
    </div>
  );
}
