import { useEffect, useState } from "react";
import { api, Room, Zone } from "../api";
import { isAdmin } from "../auth";
import { TableSkeleton } from "../components/Skeleton";
import RoomImages, { PendingImage } from "../components/RoomImages";
import ZonesCard from "../components/ZonesCard";

type FormState = {
  id?: number;
  name: string;
  zone_id: string;
  capacity: string;
  meter_squared: string;
  open_time: string;
  close_time: string;
  notes: string;
  is_active: boolean;
  is_coffee_break: boolean;
};

const EMPTY: FormState = {
  name: "",
  zone_id: "",
  capacity: "10",
  meter_squared: "",
  open_time: "08:00",
  close_time: "20:00",
  notes: "",
  is_active: true,
  is_coffee_break: false,
};

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  // Photos picked during creation, before the room (and its id) exist.
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const admin = isAdmin();

  const loadRooms = () => api.listRooms().then(setRooms);
  const loadZones = () => api.listZones().then(setZones);
  const reload = () => Promise.all([loadRooms(), loadZones()]);
  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  const startCreate = () => {
    setError(null);
    setPending([]);
    setForm({ ...EMPTY, zone_id: zones[0] ? String(zones[0].id) : "" });
  };
  const startEdit = (r: Room) => {
    setError(null);
    setPending([]);
    setForm({
      id: r.id,
      name: r.name,
      zone_id: String(r.zone_id),
      capacity: String(r.capacity),
      meter_squared: r.meter_squared != null ? String(r.meter_squared) : "",
      open_time: r.open_time.slice(0, 5),
      close_time: r.close_time.slice(0, 5),
      notes: r.notes ?? "",
      is_active: r.is_active,
      is_coffee_break: r.is_coffee_break,
    });
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        zone_id: parseInt(form.zone_id, 10),
        capacity: parseInt(form.capacity, 10),
        meter_squared: form.meter_squared.trim() ? parseInt(form.meter_squared, 10) : null,
        open_time: form.open_time + ":00",
        close_time: form.close_time + ":00",
        notes: form.notes || null,
        is_active: form.is_active,
        is_coffee_break: form.is_coffee_break,
      };
      if (form.id) {
        await api.updateRoom(form.id, payload as Partial<Room>);
      } else {
        const room = await api.createRoom(payload as Partial<Room>);
        if (pending.length > 0) {
          // Switch the form to edit mode first, so if the photo upload fails the user
          // can retry without re-creating (and duplicating) the room.
          setForm({ ...form, id: room.id });
          await api.uploadRoomImages(
            room.id,
            pending.map(({ content_type, data }) => ({ content_type, data })),
          );
          setPending([]);
        }
      }
      setForm(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (id: number) => {
    if (!confirm("Скрыть помещение из списка?")) return;
    setBusy(true);
    try {
      await api.deactivateRoom(id);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const noZones = !loading && zones.length === 0;

  return (
    <div>
      <h2>Помещения и зоны</h2>

      <ZonesCard zones={zones} onChanged={reload} />

      <div className="page-head" style={{ marginTop: 26 }}>
        <h3 className="section-title">Помещения</h3>
        {admin && <button className="primary" onClick={startCreate} disabled={noZones}>+ Новое помещение</button>}
      </div>
      {noZones && <div className="page-hint">Сначала создайте хотя бы одну зону — помещения добавляются в зону.</div>}

      {form && (
        <div className="card">
          <h3>{form.id ? `Помещение №${form.id}` : "Новое помещение"}</h3>
          <div className="field"><label>Название</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="row2">
            <div className="field"><label>Зона</label>
              <select value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value })}>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            </div>
            <div className="field"><label>Вместимость</label>
              <input value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                inputMode="numeric" /></div>
          </div>
          <div className="row2">
            <div className="field"><label>Площадь, м²</label>
              <input value={form.meter_squared} placeholder="напр. 45" inputMode="numeric"
                onChange={(e) => setForm({ ...form, meter_squared: e.target.value })} /></div>
            <div className="field" />
          </div>
          <div className="row2">
            <div className="field"><label>Открытие</label>
              <input type="time" value={form.open_time} onChange={(e) => setForm({ ...form, open_time: e.target.value })} /></div>
            <div className="field"><label>Закрытие</label>
              <input type="time" value={form.close_time} onChange={(e) => setForm({ ...form, close_time: e.target.value })} /></div>
          </div>
          <div className="field"><label>Заметки</label>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="field">
            <label>
              <input type="checkbox" style={{ width: "auto", marginRight: 6 }}
                checked={form.is_coffee_break} onChange={(e) => setForm({ ...form, is_coffee_break: e.target.checked })} />
              Кофе-брейк (зона для кейтеринга, недоступна для бронирования)
            </label>
          </div>
          <div className="field">
            <label>
              <input type="checkbox" style={{ width: "auto", marginRight: 6 }}
                checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Активно (доступно для бронирования)
            </label>
          </div>
          {form.id ? (
            <RoomImages roomId={form.id} />
          ) : (
            <RoomImages pending={pending} onPendingChange={setPending} />
          )}
          <div className="actions">
            <button className="primary" onClick={save} disabled={busy || !form.name || !form.zone_id}>Сохранить</button>
            <button onClick={() => setForm(null)}>Отмена</button>
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      )}

      {loading ? (
        <TableSkeleton cols={6} rows={5} />
      ) : rooms.length === 0 ? (
        <div className="empty">Помещений нет. Создайте первое.</div>
      ) : (
        <table>
          <thead>
            <tr><th>Название</th><th>Зона</th><th>Вместимость</th><th>Часы</th><th>Статус</th><th></th></tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name}
                  {r.is_coffee_break && <span className="badge coffee" style={{ marginLeft: 8 }}>кофе-брейк</span>}
                </td>
                <td><span className="badge zone">{r.zone_name}</span></td>
                <td>{r.capacity}{r.meter_squared != null && <span style={{ color: "var(--muted)" }}> · {r.meter_squared} м²</span>}</td>
                <td>{r.open_time.slice(0, 5)}–{r.close_time.slice(0, 5)}</td>
                <td><span className={`badge ${r.is_active ? "active" : "inactive"}`}>{r.is_active ? "активно" : "скрыто"}</span></td>
                <td style={{ textAlign: "right" }}>
                  {admin ? (
                    <>
                      <button onClick={() => startEdit(r)}>Изменить</button>{" "}
                      {r.is_active && <button className="danger" onClick={() => deactivate(r.id)}>Скрыть</button>}
                    </>
                  ) : (
                    <span className="muted-dash">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
