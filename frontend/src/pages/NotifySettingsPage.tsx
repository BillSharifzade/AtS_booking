import { useEffect, useState } from "react";
import { api, NotifyPrefs } from "../api";
import { isAdmin } from "../auth";
import { CardSkeleton } from "../components/Skeleton";

type Toggle = {
  key: keyof NotifyPrefs;
  label: string;
  hint: string;
  /** Only meaningful while another switch is on. */
  dependsOn?: keyof NotifyPrefs;
};

const TOGGLES: Toggle[] = [
  {
    key: "new_bookings",
    label: "Новые заявки",
    hint: "Каждая созданная заявка приходит администраторам в Telegram.",
  },
  {
    key: "urgent_only",
    label: "Только срочные заявки",
    hint: "Присылать не все новые заявки, а только срочные (менее 2 дней до мероприятия или отмеченные вручную).",
    dependsOn: "new_bookings",
  },
  {
    key: "status_changes",
    label: "Изменения статуса",
    hint: "Подтверждение, отклонение, завершение и архивация. Выключено — администраторы не получают уведомление на каждое действие; статус всегда виден в панели.",
  },
  {
    key: "chat_messages",
    label: "Сообщения от заказчиков",
    hint: "Сообщения из чата с ботом дублируются в Telegram. Сами сообщения в панели сохраняются в любом случае.",
  },
];

export default function NotifySettingsPage() {
  const admin = isAdmin();
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getNotifyPrefs()
      .then(setPrefs)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const save = async (next: NotifyPrefs) => {
    setPrefs(next);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      setPrefs(await api.updateNotifyPrefs(next));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h2>Уведомления</h2>
        <div className="page-head-actions">
          {saving ? <span className="chart-note">Сохранение…</span> : saved ? <span className="chart-note">Сохранено ✓</span> : null}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {loading || !prefs ? (
        <CardSkeleton lines={4} />
      ) : (
        <section className="card" style={{ maxWidth: 720 }}>
          <div className="card-head">
            <h3>Что присылать администраторам в Telegram</h3>
          </div>
          <p className="field-hint" style={{ marginBottom: 18 }}>
            Настройка общая для всех администраторов. Заказчики уведомления получают всегда —
            здесь только внутренние сообщения панели.
          </p>
          {TOGGLES.map((t) => {
            const disabled = !admin || saving || (t.dependsOn ? !prefs[t.dependsOn] : false);
            return (
              <div className="field" key={t.key}>
                <label style={{ opacity: disabled && t.dependsOn ? 0.55 : 1 }}>
                  <input
                    type="checkbox"
                    style={{ width: "auto", marginRight: 8 }}
                    checked={prefs[t.key]}
                    disabled={disabled}
                    onChange={(e) => save({ ...prefs, [t.key]: e.target.checked })}
                  />
                  {t.label}
                </label>
                <span className="field-hint">{t.hint}</span>
              </div>
            );
          })}
          {!admin && <div className="field-hint">Изменять настройки может только администратор.</div>}
        </section>
      )}
    </div>
  );
}
