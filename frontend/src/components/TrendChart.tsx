import { useMemo, useState } from "react";
import type { TrendPoint } from "../api";

// Booking-frequency column chart. One series (заявки), so no legend — the card
// title names what's plotted. Hours are deliberately NOT a second y-axis: they ride
// along in the tooltip and the table view instead.

/** Round up to a tick-friendly even number so the midpoint gridline stays whole. */
function niceMax(v: number): number {
  if (v <= 0) return 2;
  if (v <= 10) return v % 2 === 0 ? v : v + 1;
  const base = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) {
    const cand = m * base;
    if (v <= cand) return Math.ceil(cand / 2) * 2;
  }
  return 10 * base;
}

const num = (n: number) => n.toLocaleString("ru-RU");

/** 1 заявка · 2 заявки · 5 заявок */
function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "заявка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "заявки";
  return "заявок";
}

export default function TrendChart({ points }: { points: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const { top, maxIdx, labelEvery } = useMemo(() => {
    const counts = points.map((p) => p.count);
    const max = Math.max(0, ...counts);
    return {
      top: niceMax(max),
      maxIdx: counts.indexOf(max),
      // Thin the x labels so they never collide at ~40px per label.
      labelEvery: Math.max(1, Math.ceil(points.length / 12)),
    };
  }, [points]);

  if (points.length === 0) return <div className="dash-empty">За период нет заявок.</div>;

  const ticks = [top, top / 2, 0];

  return (
    <div className="trend">
      <div className="trend-head">
        <button type="button" className="trend-toggle" onClick={() => setAsTable((v) => !v)}>
          {asTable ? "График" : "Таблица"}
        </button>
      </div>

      {asTable ? (
        <div className="trend-table-wrap">
          <table className="mini-table">
            <thead>
              <tr><th>Период</th><th>Заявок</th><th>Часов</th></tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  <td>{num(p.count)}</td>
                  <td>{p.hours.toLocaleString("ru-RU")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="trend-plot">
            <div className="trend-ticks">
              {ticks.map((t) => (
                <div className="trend-tick" key={t}>
                  <span className="trend-tick-label">{num(t)}</span>
                  <span className="trend-tick-line" />
                </div>
              ))}
            </div>
            <div className="trend-cols" onMouseLeave={() => setHover(null)}>
              {points.map((p, i) => (
                <div
                  key={p.key}
                  className={`trend-col ${hover === i ? "on" : ""}`}
                  onMouseEnter={() => setHover(i)}
                  tabIndex={0}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label={`${p.label}: ${p.count} ${plural(p.count)}, ${p.hours} ч`}
                >
                  <span className="trend-bar" style={{ height: `${(p.count / top) * 100}%` }}>
                    {/* Only the peak is direct-labelled, on the cap; the axis and
                        tooltip carry the rest. */}
                    {i === maxIdx && p.count > 0 && <span className="trend-peak">{num(p.count)}</span>}
                  </span>
                </div>
              ))}
              {hover !== null && (() => {
                const pos = (hover + 0.5) / points.length;
                // Flip the anchor near the edges so the tip never spills out of the card.
                const align = pos < 0.12 ? "start" : pos > 0.88 ? "end" : "mid";
                return (
                  <div className={`trend-tip ${align}`} style={{ left: `${pos * 100}%` }} role="status">
                    <b>{points[hover].label}</b>
                    <span>{num(points[hover].count)} {plural(points[hover].count)}</span>
                    <span>{points[hover].hours.toLocaleString("ru-RU")} ч</span>
                  </div>
                );
              })()}
            </div>
          </div>
          <div className="trend-xaxis">
            {points.map((p, i) => (
              <span key={p.key} className="trend-x">
                {i % labelEvery === 0 ? p.label : ""}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
