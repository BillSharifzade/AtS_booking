import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendPoint } from "../../api";
import Tip, { CURSOR } from "./Tip";
import { AXIS, pluralBookings, ru, VIZ } from "./theme";

// Booking frequency over the selected period. ONE series (заявки) on ONE axis —
// hours ride along in the tooltip rather than becoming a second y-scale.
export default function TrendChart({ points }: { points: TrendPoint[] }) {
  // Thin the x labels so they never collide at roughly 48px per label.
  const interval = Math.max(0, Math.ceil(points.length / 14) - 1);

  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} stroke={VIZ.grid} />
        <XAxis dataKey="label" interval={interval} {...AXIS} />
        <YAxis allowDecimals={false} width={40} {...AXIS} />
        <Tooltip
          cursor={CURSOR}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as TrendPoint;
            return (
              <Tip
                title={p.label}
                rows={[
                  { label: pluralBookings(p.count), value: ru(p.count), color: VIZ.accent },
                  { label: "часов", value: p.hours.toLocaleString("ru-RU") },
                ]}
              />
            );
          }}
        />
        <Bar dataKey="count" fill={VIZ.accent} radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}
