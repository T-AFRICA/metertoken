import { Icon } from './Icon';

/** Shimmering placeholder rows while a table loads, so "nothing found" never flashes first. */
export function SkeletonRows({ cols, rows = 4 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} className="skeleton-row" aria-hidden="true">
          {Array.from({ length: cols }, (_, j) => (
            <td key={j}>
              <span style={{ width: `${45 + ((i * 7 + j * 13) % 40)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Full-area loader with the brand bolt, for whole pages that are still loading. */
export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="page-loader" role="status" aria-label={label}>
      <span className="page-loader-badge"><Icon name="bolt" size={22} /></span>
      <span className="page-loader-bar"><i /></span>
    </div>
  );
}
