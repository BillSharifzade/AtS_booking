import { useEffect, useState } from "react";
import { api, ChecklistItem } from "../api";
import { isAdmin } from "../auth";
import { TableSkeleton } from "../components/Skeleton";

export default function ChecklistPage() {
  const admin = isAdmin();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const load = () => api.listChecklist().then(setItems).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try { await api.createChecklistItem(text.trim()); setText(""); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const saveEdit = async () => {
    if (editId == null || !editText.trim()) return;
    setBusy(true);
    try { await api.updateChecklistItem(editId, { text: editText.trim() }); setEditId(null); await load(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async (it: ChecklistItem) => {
    if (!confirm(`Удалить пункт «${it.text}»?`)) return;
    setBusy(true);
    try { await api.deleteChecklistItem(it.id); await load(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="page-head"><h2>Чек-лист подготовки</h2></div>
      <p className="page-hint">Эти пункты автоматически добавляются в каждую новую заявку. Администратор отмечает их выполнение на странице заявки.</p>
      {error && <div className="error">{error}</div>}

      {admin && (
        <div className="field" style={{ maxWidth: 560, marginBottom: 18 }}>
          <label>Новый пункт</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={text} placeholder="напр. Проверить проектор и звук"
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            <button className="primary" disabled={busy || !text.trim()} onClick={add}>Добавить</button>
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton cols={2} rows={4} />
      ) : items.length === 0 ? (
        <div className="empty">Пунктов пока нет.</div>
      ) : (
        <div className="checklist" style={{ maxWidth: 640 }}>
          {items.map((it, i) => (
            <div key={it.id} className="checklist-item">
              <span style={{ color: "var(--muted-2)", width: 22, fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>
              {editId === it.id ? (
                <>
                  <input style={{ flex: 1 }} value={editText} autoFocus
                    onChange={(e) => setEditText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} />
                  <button className="row-act" onClick={saveEdit}>✓</button>
                  <button className="row-act" onClick={() => setEditId(null)}>✕</button>
                </>
              ) : (
                <>
                  <span className="ci-text" style={{ flex: 1 }}>{it.text}</span>
                  {admin && (
                    <>
                      <button className="row-act" title="Изменить" onClick={() => { setEditId(it.id); setEditText(it.text); }}>✎</button>
                      <button className="row-act danger" title="Удалить" onClick={() => remove(it)}>✕</button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
