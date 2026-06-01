import { useEffect, useState } from "react";
import { api, PanelUser } from "../api";
import { TableSkeleton } from "../components/Skeleton";

function fmt(dt: string) {
  return new Date(dt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function UsersPage() {
  const [users, setUsers] = useState<PanelUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [tgId, setTgId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listPanelUsers().then(setUsers).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const add = async () => {
    const id = parseInt(tgId, 10);
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.addPanelUser(id, name.trim() || null);
      setTgId("");
      setName("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Убрать доступ этому наблюдателю?")) return;
    setBusy(true);
    setError(null);
    try {
      await api.removePanelUser(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>Пользователи</h2>
      <p className="page-hint">
        Наблюдатели (руководители подразделений) входят по своему Telegram ID и видят панель
        <b> только для чтения</b> — дашборд, заявки, помещения, журнал. Администраторы задаются
        переменной <code>ADMIN_TELEGRAM_IDS</code> и здесь не отображаются.
      </p>

      <div className="card">
        <h3>Добавить наблюдателя</h3>
        <div className="row2">
          <div className="field">
            <label>Telegram ID</label>
            <input
              value={tgId}
              inputMode="numeric"
              placeholder="например, 1320166360"
              onChange={(e) => setTgId(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
          <div className="field">
            <label>Имя (необязательно)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ФИО / подразделение" />
          </div>
        </div>
        <div className="actions">
          <button className="primary" onClick={add} disabled={busy || !tgId}>Добавить</button>
        </div>
        {error && <div className="error">{error}</div>}
        <span className="field-hint">ID можно узнать, отправив боту команду <code>/whoami</code>.</span>
      </div>

      {loading ? (
        <TableSkeleton cols={4} rows={3} />
      ) : users.length === 0 ? (
        <div className="empty">Наблюдателей нет. Добавьте первого выше.</div>
      ) : (
        <table>
          <thead>
            <tr><th>Telegram ID</th><th>Имя</th><th>Роль</th><th>Добавлен</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.telegram_id}>
                <td>{u.telegram_id}</td>
                <td>{u.name || "—"}</td>
                <td><span className="badge zone">наблюдатель</span></td>
                <td>{fmt(u.created_at)}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="danger" disabled={busy} onClick={() => remove(u.telegram_id)}>Убрать</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
