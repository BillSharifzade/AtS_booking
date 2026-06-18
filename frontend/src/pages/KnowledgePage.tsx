import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, Article } from "../api";
import { isAdmin } from "../auth";
import { CardSkeleton } from "../components/Skeleton";

// Categories mirror the panel's modules.
const CATEGORY_LABELS: Record<string, string> = {
  general: "Общее",
  bookings: "Заявки",
  rooms: "Помещения",
  coffee: "Кофе-брейки",
  props: "Оборудование",
  companies: "Компании",
  checklist: "Чек-лист",
  reviews: "Отзывы",
};
const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABELS);
const catLabel = (c: string) => CATEGORY_LABELS[c] ?? c;

type Form = { id: number | null; title: string; category: string; body: string };
const EMPTY: Form = { id: null, title: "", category: "general", body: "" };

export default function KnowledgePage() {
  const admin = isAdmin();
  const [items, setItems] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const [open, setOpen] = useState<Article | null>(null);
  const [editing, setEditing] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listArticles({ q: q || undefined, category: cat || undefined })
    .then(setItems).finally(() => setLoading(false));
  useEffect(() => { setLoading(true); const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q, cat]);

  const cats = useMemo(() => {
    const present = Array.from(new Set(items.map((a) => a.category)));
    return present;
  }, [items]);

  const save = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    const body = { title: editing.title.trim(), category: editing.category, body: editing.body.trim() };
    try {
      if (editing.id == null) await api.createArticle(body);
      else await api.updateArticle(editing.id, body);
      setEditing(null); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async (a: Article) => {
    if (!confirm(`Удалить статью «${a.title}»?`)) return;
    setBusy(true);
    try { await api.deleteArticle(a.id); setOpen(null); await load(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="page-head">
        <h2>База знаний</h2>
        {admin && <button className="primary" onClick={() => { setError(null); setEditing({ ...EMPTY }); }}>+ Статья</button>}
      </div>

      <div style={{ marginBottom: 16, maxWidth: 420 }}>
        <input value={q} placeholder="Поиск по статьям…" onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="kb-layout">
        <div className="kb-cats">
          <button className={`kb-cat ${cat === "" ? "on" : ""}`} onClick={() => setCat("")}>Все категории</button>
          {(cat ? Array.from(new Set([cat, ...cats])) : cats).map((c) => (
            <button key={c} className={`kb-cat ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{catLabel(c)}</button>
          ))}
        </div>

        <div>
          {loading ? (
            <div className="entity-grid"><CardSkeleton /><CardSkeleton /></div>
          ) : items.length === 0 ? (
            <div className="empty">Статей не найдено.</div>
          ) : (
            <div className="entity-grid">
              {items.map((a) => (
                <div key={a.id} className="entity-card" style={{ cursor: "pointer" }} onClick={() => setOpen(a)}>
                  <div className="ec-head">
                    <span className="ec-title">{a.title}</span>
                  </div>
                  <span className="badge zone" style={{ alignSelf: "flex-start" }}>{catLabel(a.category)}</span>
                  <div className="ec-desc" style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{a.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Read modal */}
      {open && createPortal(
        <div className="modal-overlay" onClick={() => setOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{open.title}</h3>
              <button className="icon-close" onClick={() => setOpen(null)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              <span className="badge zone" style={{ marginBottom: 12, display: "inline-block" }}>{catLabel(open.category)}</span>
              <div className="kb-article-body">{open.body}</div>
            </div>
            {admin && (
              <div className="modal-foot">
                <button className="danger" onClick={() => remove(open)}>Удалить</button>
                <button onClick={() => { setEditing({ id: open.id, title: open.title, category: open.category, body: open.body }); setOpen(null); }}>Изменить</button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* Edit modal */}
      {editing && createPortal(
        <div className="modal-overlay" onClick={() => !busy && setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{editing.id == null ? "Новая статья" : "Изменить статью"}</h3>
              <button className="icon-close" onClick={() => setEditing(null)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="error">{error}</div>}
              <div className="field"><label>Заголовок</label>
                <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></div>
              <div className="field"><label>Категория</label>
                <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                  {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
                </select></div>
              <div className="field"><label>Текст</label>
                <textarea rows={10} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setEditing(null)}>Отмена</button>
              <button className="primary" disabled={busy || !editing.title.trim() || !editing.body.trim()} onClick={save}>Сохранить</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
