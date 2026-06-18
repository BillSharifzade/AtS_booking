import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, Prop } from "../api";
import { isAdmin } from "../auth";
import { TableSkeleton } from "../components/Skeleton";

type Form = {
  id: number | null;
  name: string;
  kind: "tech" | "office";
  unit: string;
  amount: string;
  description: string;
  is_active: boolean;
};

const EMPTY: Form = { id: null, name: "", kind: "tech", unit: "", amount: "0", description: "", is_active: true };

const KIND_LABEL: Record<string, string> = { tech: "Техника", office: "Расходники" };

export default function PropsPage() {
  const admin = isAdmin();
  const [items, setItems] = useState<Prop[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<"" | "tech" | "office">("");

  const load = () => api.listProps().then(setItems).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const openNew = () => { setError(null); setEditing({ ...EMPTY }); };
  const openEdit = (p: Prop) => setEditing({
    id: p.id, name: p.name, kind: p.kind, unit: p.unit ?? "", amount: String(p.amount),
    description: p.description ?? "", is_active: p.is_active,
  });

  const save = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    const body = {
      name: editing.name.trim(),
      kind: editing.kind,
      unit: editing.kind === "office" ? (editing.unit.trim() || null) : null,
      amount: parseInt(editing.amount, 10) || 0,
      description: editing.description.trim() || null,
      is_active: editing.is_active,
    };
    try {
      if (editing.id == null) await api.createProp(body);
      else await api.updateProp(editing.id, body);
      setEditing(null); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const remove = async (p: Prop) => {
    if (!confirm(`Удалить «${p.name}»?`)) return;
    setBusy(true);
    try { await api.deleteProp(p.id); await load(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  };

  const shown = kindFilter ? items.filter((p) => p.kind === kindFilter) : items;

  return (
    <div>
      <div className="page-head">
        <h2>Оборудование</h2>
        {admin && <button className="primary" onClick={openNew}>+ Позиция</button>}
      </div>
      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={`chip ${kindFilter === "" ? "active" : ""}`} onClick={() => setKindFilter("")}>Все</button>
        <button className={`chip ${kindFilter === "tech" ? "active" : ""}`} onClick={() => setKindFilter("tech")}>Техника</button>
        <button className={`chip ${kindFilter === "office" ? "active" : ""}`} onClick={() => setKindFilter("office")}>Расходники</button>
      </div>

      {loading ? (
        <TableSkeleton cols={5} rows={5} />
      ) : shown.length === 0 ? (
        <div className="empty">Позиций нет.</div>
      ) : (
        <table>
          <thead>
            <tr><th>Название</th><th>Тип</th><th>Кол-во</th><th>Описание</th><th>Статус</th>{admin && <th></th>}</tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td><span className="badge zone">{KIND_LABEL[p.kind]}</span></td>
                <td><span className={`amount-pill ${p.amount > 0 ? "ok" : "low"}`}>{p.amount} {p.unit || "шт."}</span></td>
                <td style={{ color: "var(--muted)" }}>{p.description || "—"}</td>
                <td><span className={`badge ${p.is_active ? "active" : "inactive"}`}>{p.is_active ? "активно" : "скрыто"}</span></td>
                {admin && (
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="row-act" title="Изменить" onClick={() => openEdit(p)}>✎</button>{" "}
                    <button className="row-act danger" title="Удалить" onClick={() => remove(p)}>✕</button>
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
              <h3>{editing.id == null ? "Новая позиция" : "Изменить позицию"}</h3>
              <button className="icon-close" onClick={() => setEditing(null)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="error">{error}</div>}
              <div className="field"><label>Название</label>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="row2">
                <div className="field"><label>Тип</label>
                  <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as "tech" | "office" })}>
                    <option value="tech">Техника</option>
                    <option value="office">Расходники</option>
                  </select></div>
                <div className="field"><label>Количество</label>
                  <input inputMode="numeric" value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} /></div>
              </div>
              {editing.kind === "office" && (
                <div className="field"><label>Единица измерения</label>
                  <input value={editing.unit} placeholder="пачка, бутылка, упаковка…" onChange={(e) => setEditing({ ...editing, unit: e.target.value })} />
                  <span className="field-hint">Для расходников: как считается количество.</span></div>
              )}
              <div className="field"><label>Описание</label>
                <textarea rows={2} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <div className="field">
                <label><input type="checkbox" style={{ width: "auto", marginRight: 8 }}
                  checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
                  Активно (можно запросить при бронировании)</label>
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setEditing(null)}>Отмена</button>
              <button className="primary" disabled={busy || !editing.name.trim()} onClick={save}>Сохранить</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
