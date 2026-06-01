import { useEffect, useMemo, useState } from "react";
import { api, BotText } from "../api";
import { isAdmin } from "../auth";
import { CardSkeleton } from "../components/Skeleton";

export default function BotTextsPage() {
  const admin = isAdmin();
  const [texts, setTexts] = useState<BotText[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.listBotTexts().then(setTexts).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const groups = useMemo(() => {
    const map = new Map<string, BotText[]>();
    for (const t of texts) {
      if (!map.has(t.group)) map.set(t.group, []);
      map.get(t.group)!.push(t);
    }
    return [...map.entries()];
  }, [texts]);

  const startEdit = (t: BotText) => {
    setError(null);
    setEditing(t.key);
    setDraft(t.value);
  };

  const save = async (t: BotText) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateBotText(t.key, draft);
      setTexts((prev) => prev.map((x) => (x.key === t.key ? updated : x)));
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetToDefault = async (t: BotText) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateBotText(t.key, t.default);
      setTexts((prev) => prev.map((x) => (x.key === t.key ? updated : x)));
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <div>
        <h2>Тексты бота</h2>
        <CardSkeleton lines={5} />
        <CardSkeleton lines={4} />
      </div>
    );

  return (
    <div>
      <h2>Тексты бота</h2>
      <p className="page-hint">
        Сообщения, которые бот отправляет заказчикам. Изменения применяются в течение ~30 секунд без перезапуска.
        Подстановки вида <code>{"{id}"}</code> нужно сохранять без изменений.
      </p>

      {groups.map(([group, items]) => (
        <div className="card" key={group}>
          <h3>{group}</h3>
          <div className="text-list">
            {items.map((t) => (
              <div className="text-row" key={t.key}>
                <div className="text-row-head">
                  <span className="text-label">
                    {t.label}
                    {t.is_overridden && <span className="badge active" style={{ marginLeft: 8 }}>изменён</span>}
                  </span>
                  {admin && editing !== t.key && (
                    <button className="link-btn" onClick={() => startEdit(t)}>Изменить</button>
                  )}
                </div>

                {editing === t.key ? (
                  <div className="text-edit">
                    <textarea rows={Math.min(8, Math.max(2, draft.split("\n").length + 1))}
                      value={draft} onChange={(e) => setDraft(e.target.value)} />
                    {t.placeholders.length > 0 && (
                      <div className="placeholder-hint">
                        Доступные подстановки: {t.placeholders.map((p) => <code key={p}>{`{${p}}`}</code>)}
                      </div>
                    )}
                    {error && <div className="error">{error}</div>}
                    <div className="actions">
                      <button className="primary" disabled={busy || !draft.trim()} onClick={() => save(t)}>Сохранить</button>
                      <button disabled={busy} onClick={() => setEditing(null)}>Отмена</button>
                      {t.is_overridden && (
                        <button className="danger" disabled={busy} onClick={() => resetToDefault(t)}>Сбросить к стандарту</button>
                      )}
                    </div>
                  </div>
                ) : (
                  <pre className="text-preview">{t.value}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
