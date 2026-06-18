import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, Company, companyLogoUrl } from "../api";
import { isAdmin } from "../auth";
import { CardSkeleton } from "../components/Skeleton";

type Form = {
  id: number | null;
  name: string;
  website_url: string;
  is_active: boolean;
  logo_content_type: string | null;
  logo_data: string | null; // base64 (no data: prefix)
  logo_preview: string | null; // data URL for preview, or existing logo URL
  logo_cleared: boolean;
};

const EMPTY: Form = {
  id: null, name: "", website_url: "", is_active: true,
  logo_content_type: null, logo_data: null, logo_preview: null, logo_cleared: false,
};

export default function CompaniesPage() {
  const admin = isAdmin();
  const [items, setItems] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listCompanies().then(setItems).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const openNew = () => { setError(null); setEditing({ ...EMPTY }); };
  const openEdit = (c: Company) => setEditing({
    id: c.id, name: c.name, website_url: c.website_url ?? "", is_active: c.is_active,
    logo_content_type: null, logo_data: null,
    logo_preview: c.has_logo ? companyLogoUrl(c.id) : null, logo_cleared: false,
  });

  const onFile = (f: File, form: Form) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const b64 = result.split(",")[1] ?? "";
      setEditing({ ...form, logo_content_type: f.type, logo_data: b64, logo_preview: result, logo_cleared: false });
    };
    reader.readAsDataURL(f);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      if (editing.id == null) {
        await api.createCompany({
          name: editing.name.trim(),
          website_url: editing.website_url.trim() || null,
          is_active: editing.is_active,
          logo_content_type: editing.logo_content_type,
          logo_data: editing.logo_data,
        });
      } else {
        const patch: Record<string, unknown> = {
          name: editing.name.trim(),
          website_url: editing.website_url.trim() || null,
          is_active: editing.is_active,
        };
        if (editing.logo_data) { patch.logo_content_type = editing.logo_content_type; patch.logo_data = editing.logo_data; }
        else if (editing.logo_cleared) { patch.logo_data = ""; }
        await api.updateCompany(editing.id, patch);
      }
      setEditing(null);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const remove = async (c: Company) => {
    if (!confirm(`Удалить компанию «${c.name}»?`)) return;
    setBusy(true);
    try { await api.deleteCompany(c.id); await load(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="page-head">
        <h2>Компании</h2>
        {admin && <button className="primary" onClick={openNew}>+ Компания</button>}
      </div>

      {loading ? (
        <div className="entity-grid"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>
      ) : items.length === 0 ? (
        <div className="empty">Компаний пока нет.{admin && " Добавьте первую."}</div>
      ) : (
        <div className="entity-grid">
          {items.map((c) => (
            <div key={c.id} className="entity-card">
              <div className="ec-head">
                {c.has_logo
                  ? <img className="company-logo" src={companyLogoUrl(c.id)} alt="" />
                  : <span className="company-logo placeholder">{c.name.slice(0, 1).toUpperCase()}</span>}
                <span className="ec-title">{c.name}</span>
                {admin && (
                  <div className="ec-actions">
                    <button className="row-act" title="Изменить" onClick={() => openEdit(c)}>✎</button>
                    <button className="row-act danger" title="Удалить" onClick={() => remove(c)}>✕</button>
                  </div>
                )}
              </div>
              <div className="ec-meta">
                <span className={`badge ${c.is_active ? "active" : "inactive"}`}>{c.is_active ? "активна" : "скрыта"}</span>
                {c.website_url && <a href={c.website_url} target="_blank" rel="noreferrer">сайт ↗</a>}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && createPortal(
        <div className="modal-overlay" onClick={() => !busy && setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{editing.id == null ? "Новая компания" : "Изменить компанию"}</h3>
              <button className="icon-close" onClick={() => setEditing(null)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              {error && <div className="error">{error}</div>}
              <div className="field"><label>Название</label>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="field"><label>Сайт</label>
                <input value={editing.website_url} placeholder="https://…" onChange={(e) => setEditing({ ...editing, website_url: e.target.value })} /></div>
              <div className="field"><label>Логотип</label>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {editing.logo_preview
                    ? <img className="company-logo" src={editing.logo_preview} alt="" />
                    : <span className="company-logo placeholder">{(editing.name || "?").slice(0, 1).toUpperCase()}</span>}
                  <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f, editing); }} />
                  {editing.logo_preview && (
                    <button type="button" onClick={() => setEditing({ ...editing, logo_data: null, logo_content_type: null, logo_preview: null, logo_cleared: true })}>Убрать</button>
                  )}
                </div>
              </div>
              <div className="field">
                <label><input type="checkbox" style={{ width: "auto", marginRight: 8 }}
                  checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
                  Активна (доступна клиентам при бронировании)</label>
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
