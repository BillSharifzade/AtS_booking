import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ROOM_STRUCT_LABELS } from "../../labels";
import Tip from "./Tip";
import { CATEGORICAL, ru, VIZ } from "./theme";

export type StructDatum = { key: string; label: string; count: number };

// Part-to-whole at a glance, ≤ 6 segments. A legend is always present and each
// slice is also labelled with its share, so identity never rests on colour alone
// (the lighter categorical slots WARN on surface contrast).
export default function StructDonut({ data }: { data: StructDatum[] }) {
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  const colorOf = (i: number) => CATEGORICAL[i % CATEGORICAL.length];

  return (
    <div className="donut-row">
      <ResponsiveContainer width="100%" height={188}>
        <PieChart>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as StructDatum & { fill: string };
              return (
                <Tip
                  title={p.label}
                  rows={[
                    { label: "заявок", value: ru(p.count), color: p.fill },
                    { label: "доля", value: `${Math.round((p.count / total) * 100)}%` },
                  ]}
                />
              );
            }}
          />
          <Pie
            data={data}
            dataKey="count"
            nameKey="label"
            innerRadius="58%"
            outerRadius="86%"
            paddingAngle={2}
            stroke={VIZ.surface}
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={d.key} fill={colorOf(i)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <ul className="viz-legend">
        {data.map((d, i) => (
          <li key={d.key}>
            <i className="viz-swatch" style={{ background: colorOf(i) }} />
            <span className="viz-legend-name">{ROOM_STRUCT_LABELS[d.key] ?? d.label}</span>
            <span className="viz-legend-val">
              {ru(d.count)} · {Math.round((d.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
