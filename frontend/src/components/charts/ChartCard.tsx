import { ReactNode, useState } from "react";

// Card shell every chart lives in: title, optional note, and a chart/table switch.
// The table view is the accessible twin — no value is ever reachable only by hover.
export default function ChartCard({
  title,
  note,
  table,
  wide,
  empty,
  children,
}: {
  title: string;
  note?: string;
  /** Rendered when the user switches to the table view. Omit to hide the switch. */
  table?: ReactNode;
  wide?: boolean;
  /** Shown instead of the chart when there's nothing to plot. */
  empty?: boolean;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card chart-card ${wide ? "span-2" : ""}`}>
      <div className="card-head">
        <h3>{title}</h3>
        <div className="chart-head-right">
          {note && <span className="chart-note">{note}</span>}
          {table && !empty && (
            <button type="button" className="chart-toggle" onClick={() => setAsTable((v) => !v)}>
              {asTable ? "График" : "Таблица"}
            </button>
          )}
        </div>
      </div>
      {empty ? (
        <div className="dash-empty">За период нет заявок.</div>
      ) : asTable && table ? (
        <div className="chart-table-wrap">{table}</div>
      ) : (
        children
      )}
    </section>
  );
}
