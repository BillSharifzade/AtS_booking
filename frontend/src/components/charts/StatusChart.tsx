import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Status } from "../../api";
import { STATUS_LABELS } from "../../labels";
import Tip, { CURSOR } from "./Tip";
import { asNum, ru, STATUS_COLORS, VIZ } from "./theme";

export type StatusDatum = { status: Status; label: string; count: number };

// Horizontal bars, one reserved status colour each, with the value direct-labelled
// at the tip — so the numbers never depend on hovering or on colour.
export default function StatusChart({ data }: { data: StatusDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={data.length * 38 + 16}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 34, bottom: 0, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={104}
          tick={{ fill: VIZ.muted, fontSize: 12.5 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={CURSOR}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as StatusDatum;
            return (
              <Tip
                title={STATUS_LABELS[p.status]}
                rows={[{ label: "заявок", value: ru(p.count), color: STATUS_COLORS[p.status] }]}
              />
            );
          }}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.status} fill={STATUS_COLORS[d.status] ?? VIZ.accent} />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            formatter={(v) => ru(asNum(v))}
            style={{ fill: VIZ.ink, fontSize: 12, fontWeight: 700 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
