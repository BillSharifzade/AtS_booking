import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, Offtime, Room } from "../api";
import { isAdmin } from "../auth";
import { TableSkeleton } from "../components/Skeleton";

type Form = {
  id: number | null;
  room_id: string;
  starts_at: string; // datetime-local
  ends_at: string;
  reason: string;
  description: string;
};

const EMPTY: Form = { id: null, room_id: "", starts_at: "", ends_at: "", reason: "", description: "" };

function fmt(dt: string) {
  return new Date(dt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}
// "2026-07-01T08:00" (datetime-local, treated as UTC wall-clock) → ISO with Z.
function toIso(local: string) { return `${local}:00Z`; }
// ISO → "YYYY-MM-DDTHH:MM" for the datetime-local input.
function toLocal(iso: string) { return iso.slice(0, 16); }

export default function OfftimesPage() {
  const admin = isAdmin();
  const [items, setItems] = useState<Offtime[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listOfftimes().then(setItems).finally(() => setLoading(false));
  useEffect(() => { load(); api.listRooms().then((rs) => setRooms(rs.filter((r) => r.is_active))); }, []);

  const openNew = () => { setError(null); setEditing({ ...EMPTY, room_id: rooms[0] ? String(rooms[0].id) : "" }); };
  const openEdit = (o: Offtime) => setEditing({
    id: o.id, room_id: String(o.room_id), starts_at: toLocal(o.starts_at), ends_at: toLocal(o.ends_at),
    reason: o.reason, description: o.description ?? "",
  });

  const save = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    const body = {
      room_id: parseInt(editing.room_id, 10),
      starts_at: toIso(editing.starts_at),
      ends_at: toIso(editing.ends_at),
      reason: editing.reason.trim(),
      description: editing.description.trim() || null,
    };
    try {
      if (editing.id == null) await api.createOfftime(body);
      else await api.updateOfftime(editing.id, body);
      setEditing(null); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async (o: Offtime) => {
    if (!confirm(`Удалить простой «${o.reason}»?`)) return;
    setBusy(true);
    try { await api.deleteOfftime(o.id); await load(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  };

  const valid = editing && editing.room_id && editing.starts_at && editing.ends_at && editing.reason.trim();

  return (
    <div>
      <div className="page-head">
        <h2>Недоступность помещений</h2>
        {admin && <button className="primary" onClick={openNew} disabled={rooms.length === 0}>+ Простой</button>}
      </div>
      <p className="page-hint">Заблокируйте помещение на период (ремонт, частное мероприятие и т.п.). В это время помещение нельзя забронировать.</p>

      {loading ? (
        <TableSkeleton cols={5} rows={4} />
      ) : items.length === 0 ? (
        <div className="empty">Запланированных простоев нет.</div>
      ) : (
        <table>
          <thead><tr><th>Помещение</th><th>Начало</th><th>Окончание</th><th>Причина</th><th>Описание</th>{admin && <th></th>}</tr></thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id}>
                <td>{o.room_name}</td>
                <td>{fmt(o.starts_at)}</td>
                <td>{fmt(o.ends_at)}</td>
                <td><span className="badge amber">{o.reason}</span></td>
                <td style={{ color: "var(--muted)" }}>{o.description || "—"}</td>
                {admin && (
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="row-act" title="Изменить" onClick={() => openEdit(o)}>✎</button>{" "}
                    <button className="row-act danger" title="Удалить" onClick={() => remove(o)}>✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && createPortal(
        <div className="modal-overlay" onClick={() => !busy && setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{editing.id == null ? "Новый простой" : "Изменить простой"}</h3>
              <button className="icon-close" onClick={() => setEditing(null)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="error">{error}</div>}
              <div className="field"><label>Помещение</label>
                <select value={editing.room_id} onChange={(e) => setEditing({ ...editing, room_id: e.target.value })}>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.zone_name})</option>)}
                </select></div>
              <div className="row2">
                <div className="field"><label>Начало</label>
                  <input type="datetime-local" value={editing.starts_at} onChange={(e) => setEditing({ ...editing, starts_at: e.target.value })} /></div>
                <div className="field"><label>Окончание</label>
                  <input type="datetime-local" value={editing.ends_at} onChange={(e) => setEditing({ ...editing, ends_at: e.target.value })} /></div>
              </div>
              <div className="field"><label>Причина</label>
                <input value={editing.reason} placeholder="Ремонт, уборка, частное мероприятие…" onChange={(e) => setEditing({ ...editing, reason: e.target.value })} /></div>
              <div className="field"><label>Описание</label>
                <textarea rows={2} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setEditing(null)}>Отмена</button>
              <button className="primary" disabled={busy || !valid} onClick={save}>Сохранить</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
