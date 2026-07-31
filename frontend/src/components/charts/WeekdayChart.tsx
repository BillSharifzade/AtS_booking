import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WeekdayStat } from "../../api";
import Tip, { CURSOR } from "./Tip";
import { asNum, AXIS, pluralBookings, ru, VIZ } from "./theme";

const SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

// Seven fixed categories with no natural magnitude order → one colour for all bars.
// Every bar is direct-labelled (only 7 of them), so there's no y-axis clutter.
export default function WeekdayChart({ data }: { data: WeekdayStat[] }) {
  const rows = data.map((w) => ({ ...w, short: SHORT[w.weekday], full: FULL[w.weekday] }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      {/* Every bar is direct-labelled, so gridlines would be pure chrome. */}
      <BarChart data={rows} margin={{ top: 20, right: 4, bottom: 0, left: -30 }}>
        <XAxis dataKey="short" {...AXIS} />
        <YAxis allowDecimals={false} width={40} tick={false} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={CURSOR}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as (typeof rows)[number];
            return (
              <Tip
                title={p.full}
                rows={[
                  { label: pluralBookings(p.count), value: ru(p.count), color: VIZ.accent },
                  { label: "часов", value: p.hours.toLocaleString("ru-RU") },
                ]}
              />
            );
          }}
        />
        <Bar dataKey="count" fill={VIZ.accent} radius={[4, 4, 0, 0]} maxBarSize={24}>
          <LabelList
            dataKey="count"
            position="top"
            formatter={(v) => (asNum(v) > 0 ? ru(asNum(v)) : "")}
            style={{ fill: VIZ.muted, fontSize: 11, fontWeight: 700 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
