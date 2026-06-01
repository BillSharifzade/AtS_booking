import { useState } from "react";
import { api, Zone, ZoneImage, roomImageUrl } from "../api";
import { isAdmin } from "../auth";

export default function ZonesCard({ zones, onChanged }: { zones: Zone[]; onChanged: () => Promise<unknown> }) {
  const admin = isAdmin();
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openGallery, setOpenGallery] = useState<number | null>(null);
  const [galleries, setGalleries] = useState<Record<number, ZoneImage[]>>({});

  const toggleGallery = async (id: number) => {
    if (openGallery === id) { setOpenGallery(null); return; }
    setOpenGallery(id);
    if (!galleries[id]) {
      try {
        const imgs = await api.zoneImages(id);
        setGalleries((g) => ({ ...g, [id]: imgs }));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    await run(() => api.createZone(name));
    setNewName("");
  };

  const saveEdit = async () => {
    if (editId == null) return;
    const name = editName.trim();
    if (!name) return;
    await run(() => api.updateZone(editId, name));
    setEditId(null);
  };

  const remove = (z: Zone) => {
    if (!confirm(`Удалить зону «${z.name}»?`)) return;
    void run(() => api.deleteZone(z.id));
  };

  return (
    <div className="card">
      <h3>Зоны</h3>
      {zones.length === 0 ? (
        <div className="zones-empty">Зон пока нет. Добавьте первую — например, «Зона A».</div>
      ) : (
        <div className="zones-list">
          {zones.map((z) => (
            <div className="zone-entry" key={z.id}>
              <div className="zone-item">
                {editId === z.id ? (
                  <input
                    className="zone-edit-input"
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void saveEdit(); if (e.key === "Escape") setEditId(null); }}
                  />
                ) : (
                  <span className="zone-item-name">{z.name}</span>
                )}
                <span className="zone-item-meta">
                  {z.room_count} {plural(z.room_count, "помещение", "помещения", "помещений")} · вместимость {z.total_capacity}
                </span>
                <span className="zone-item-actions">
                  {editId === z.id ? (
                    <>
                      <button className="link-btn" disabled={busy} onClick={saveEdit}>Сохранить</button>
                      <button className="link-btn" onClick={() => setEditId(null)}>Отмена</button>
                    </>
                  ) : (
                    <>
                      <button className="link-btn" onClick={() => toggleGallery(z.id)}>
                        {openGallery === z.id ? "Скрыть фото" : "Фото"}
                      </button>
                      {admin && <button className="link-btn" onClick={() => { setEditId(z.id); setEditName(z.name); }}>Переименовать</button>}
                      {admin && <button className="link-btn danger-link" disabled={busy} onClick={() => remove(z)}>Удалить</button>}
                    </>
                  )}
                </span>
              </div>
              {openGallery === z.id && (
                galleries[z.id] === undefined ? (
                  <div className="zone-gallery-empty">Загрузка…</div>
                ) : galleries[z.id].length === 0 ? (
                  <div className="zone-gallery-empty">В помещениях этой зоны пока нет фотографий.</div>
                ) : (
                  <div className="zone-gallery">
                    {galleries[z.id].map((img) => (
                      <img key={img.image_id} src={roomImageUrl(img.room_id, img.image_id)} alt={img.room_name} title={img.room_name} loading="lazy" />
                    ))}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}

      {admin && (
        <div className="zone-add">
          <input
            placeholder="Название новой зоны"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
          />
          <button className="primary" disabled={busy || !newName.trim()} onClick={add}>Добавить зону</button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
