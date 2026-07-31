import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Tip, { CURSOR, TipRow } from "./Tip";
import { asNum, VIZ } from "./theme";

export type HBarDatum = {
  name: string;
  value: number;
  /** Optional richer heading for the tooltip (defaults to `name`). */
  tipTitle?: string;
  tip: TipRow[];
};

// Ranked horizontal bars for nominal categories (rooms, zones). One series, one
// colour — bar length already encodes magnitude, so a value-ramp would spend the
// colour channel on information the chart shows twice. Values are direct-labelled
// at the tip, so nothing is gated behind hover.
export default function HBarChart({
  data,
  valueLabel,
  nameWidth = 112,
}: {
  data: HBarDatum[];
  valueLabel: (v: number) => string;
  nameWidth?: number;
}) {
  const rows = [...data].sort((a, b) => b.value - a.value);
  return (
    <ResponsiveContainer width="100%" height={Math.max(rows.length * 34 + 16, 110)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 54, bottom: 0, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={nameWidth}
          tick={{ fill: VIZ.muted, fontSize: 12.5 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={CURSOR}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as HBarDatum;
            return <Tip title={p.tipTitle ?? p.name} rows={p.tip} />;
          }}
        />
        <Bar dataKey="value" fill={VIZ.accent} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v) => valueLabel(asNum(v))}
            style={{ fill: VIZ.ink, fontSize: 12, fontWeight: 700 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
