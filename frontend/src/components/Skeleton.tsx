import type { CSSProperties } from "react";

function Bar({ w, h = 15, style }: { w?: string | number; h?: number; style?: CSSProperties }) {
  return <span className="sk" style={{ width: w ?? "100%", height: h, ...style }} />;
}

const WIDTHS = ["58%", "72%", "46%", "64%", "52%", "68%", "42%"];

/** Optimized table placeholder: one shimmer sweep over the whole block. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="skeleton-table skeleton-sweep" style={{ "--cols": cols } as CSSProperties}>
      <div className="skeleton-row skeleton-head">
        {Array.from({ length: cols }).map((_, i) => (
          <Bar key={i} w="52%" h={11} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div className="skeleton-row" key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <Bar key={c} w={WIDTHS[(r + c) % WIDTHS.length]} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Key/value card placeholder, matching the `.kv` layout. */
export function CardSkeleton({ lines = 4, title = true }: { lines?: number; title?: boolean }) {
  return (
    <div className="card skeleton-sweep">
      {title && <Bar w="32%" h={12} style={{ marginBottom: 22 }} />}
      <div className="sk-kv-list">
        {Array.from({ length: lines }).map((_, i) => (
          <div className="sk-kv" key={i}>
            <Bar w="60%" />
            <Bar w={`${62 - (i % 3) * 10}%`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export { Bar as Skeleton };
