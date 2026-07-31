import { VIZ } from "./theme";

export type TipRow = { label: string; value: string; color?: string };

/** One tooltip look for every chart on the page. */
export default function Tip({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="viz-tip">
      <b>{title}</b>
      {rows.map((r) => (
        <span key={r.label}>
          {r.color && <i className="viz-tip-dot" style={{ background: r.color }} />}
          {r.label}: <em>{r.value}</em>
        </span>
      ))}
    </div>
  );
}

/** Cursor fill for bar charts — a faint wash, not a solid block. */
export const CURSOR = { fill: VIZ.accentSoft, opacity: 0.7 };
