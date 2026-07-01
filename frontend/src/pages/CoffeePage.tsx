import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, CoffeeBreak, Room } from "../api";
import { isAdmin } from "../auth";
import { COFFEE_STATUS_LABELS, COFFEE_STATUS_ORDER } from "../labels";
import { TableSkeleton } from "../components/Skeleton";

function fmt(dt: string) {
  return new Date(dt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

const STATUS_CLASS: Record<string, string> = {
  pending: "amber",
  ready: "active",
  served: "zone",
  not_required: "inactive",
};

export default function CoffeePage() {
  const nav = useNavigate();
  const admin = isAdmin();
  const [items, setItems] = useState<CoffeeBreak[]>([]);
  const [coffeeRooms, setCoffeeRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listCoffee().then(setItems).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.listRooms().then((rs) => setCoffeeRooms(rs.filter((r) => r.is_active && r.is_coffee_break)));
  }, []);

  const patch = async (id: number, body: { coffee_status?: string; coffee_room_id?: number | null }) => {
    setBusy(true);
    setError(null);
    try {
      await api.setCoffee(id, body);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>Кофе-брейки</h2>
      {error && <div className="error">{error}</div>}

      {loading ? (
        <TableSkeleton cols={6} rows={5} />
      ) : items.length === 0 ? (
        <div className="empty">Предстоящих кофе-брейков нет.</div>
      ) : (
        <table className="clickable-rows">
          <thead>
            <tr>
              <th>Когда</th>
              <th>Мероприятие</th>
              <th>Зал · зона</th>
              <th>Кол-во</th>
              <th>Статус</th>
              <th>Помещение кофе-брейка</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td onClick={() => nav(`/bookings/${c.id}`)}>{fmt(c.starts_at)}</td>
                <td onClick={() => nav(`/bookings/${c.id}`)}>№{c.id} · {c.event_name}</td>
                <td onClick={() => nav(`/bookings/${c.id}`)}>{c.room} · {c.zone}</td>
                <td onClick={() => nav(`/bookings/${c.id}`)}>{c.coffee_headcount ?? "—"}</td>
                <td>
                  {admin ? (
                    <select
                      value={c.coffee_status}
                      disabled={busy}
                      onChange={(e) => patch(c.id, { coffee_status: e.target.value })}
                    >
                      {COFFEE_STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>{COFFEE_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`badge ${STATUS_CLASS[c.coffee_status] || "zone"}`}>
                      {COFFEE_STATUS_LABELS[c.coffee_status] || c.coffee_status}
                    </span>
                  )}
                </td>
                <td>
                  {c.foreign_guests ? (
                    <span className="badge zone">в зале (иностранцы)</span>
                  ) : admin ? (
                    <select
                      value={c.coffee_room_id ?? ""}
                      disabled={busy}
                      onChange={(e) => patch(c.id, { coffee_room_id: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">— не назначено —</option>
                      {coffeeRooms.map((r) => (
                        <option key={r.id} value={r.id}>{r.name} ({r.zone_name})</option>
                      ))}
                    </select>
                  ) : (
                    c.coffee_room || "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {admin && coffeeRooms.length === 0 && !loading && (
        <p className="page-hint">Подсказка: помещения для кофе-брейка задаются галочкой «кофе-брейк» в разделе «Помещения».</p>
      )}
    </div>
  );
}
