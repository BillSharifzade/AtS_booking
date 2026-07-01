import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, BookingWithRoom, Room } from "../api";
import { isAdmin } from "../auth";
import { COFFEE_STATUS_LABELS, COFFEE_STATUS_ORDER, COFFEE_TYPE_LABELS, RESULT_OUTCOME_LABELS, RESULT_OUTCOME_ORDER, ROOM_STRUCT_LABELS } from "../labels";
import StatusBadge from "../components/StatusBadge";
import UserName from "../components/UserName";
import ChatModal from "../components/ChatModal";
import RoomStructDiagram from "../components/RoomStructDiagram";
import Stars from "../components/Stars";
import { CardSkeleton } from "../components/Skeleton";
import { useNotifications } from "../notifications";

// Booking start/end are stored as local wall-clock labelled Z, so format in UTC
// to show the exact time the customer picked (matches the client mini app).
function fmt(dt: string) {
  return new Date(dt).toLocaleString("ru-RU", { timeZone: "UTC" });
}

export default function BookingDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [b, setB] = useState<BookingWithRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [completeMode, setCompleteMode] = useState(false);
  const [outcome, setOutcome] = useState("held");
  const [resultNote, setResultNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reassignTo, setReassignTo] = useState("");
  const { unreadFor, markChatSeen } = useNotifications();

  const load = () => {
    api.getBooking(Number(id)).then(setB).catch((e) => setError(e.message));
  };
  useEffect(load, [id]);
  useEffect(() => {
    api.listRooms().then((rs) => setRooms(rs.filter((r) => r.is_active)));
  }, []);
  const reassignRooms = rooms.filter((r) => !r.is_coffee_break);
  const coffeeRooms = rooms.filter((r) => r.is_coffee_break);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      setRejectMode(false);
      setRejectReason("");
      setCompleteMode(false);
      setResultNote("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!b) {
    if (error) return <div className="empty">{error}</div>;
    return (
      <div>
        <h2><span className="sk" style={{ width: 220, height: 26, borderRadius: 8 }} /></h2>
        <div className="skeleton-grid" style={{ marginTop: 24 }}>
          <CardSkeleton lines={6} />
          <CardSkeleton lines={4} />
        </div>
        <CardSkeleton lines={3} />
      </div>
    );
  }

  const canApprove = b.status === "new" || b.status === "processing";
  const canReject = b.status === "new" || b.status === "processing" || b.status === "approved";
  const canComplete = b.status === "approved";
  const canArchive = b.status === "completed" || b.status === "rejected";
  const admin = isAdmin();
  const canReassign = admin && (b.status === "new" || b.status === "processing" || b.status === "approved");

  return (
    <div>
      <h2>
        Заявка №{b.id} <StatusBadge status={b.status} />
      </h2>
      {b.is_urgent && b.status !== "archived" && (
        <div className="urgent-line"><span className="badge urgent">срочно</span></div>
      )}
      <button className="back-link" onClick={() => nav(-1)}>
        ← Назад
      </button>

      <div className="detail-grid">
        <div className="card">
          <h3>Мероприятие</h3>
          <div className="kv">
            <div className="k">Название</div><div>{b.event_name}</div>
            <div className="k">Тип</div><div>{b.event_type}</div>
            <div className="k">Описание</div><div>{b.description || "—"}</div>
            <div className="k">Помещение</div><div>{b.room.name} (зона {b.room.zone_name})</div>
            <div className="k">Начало</div><div>{fmt(b.starts_at)}</div>
            <div className="k">Окончание</div><div>{fmt(b.ends_at)}</div>
            <div className="k">Участников</div><div>{b.attendees}</div>
            {b.room_struct && (
              <>
                <div className="k">Расстановка</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <RoomStructDiagram struct={b.room_struct} className="struct-mini" />
                  <span>{ROOM_STRUCT_LABELS[b.room_struct]}</span>
                </div>
              </>
            )}
            <div className="k">Кофе-брейк</div>
            <div>
              {b.coffee_break ? `да${b.coffee_headcount ? ` · ${b.coffee_headcount} шт.` : ""}` : "нет"}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Заказчик</h3>
            <button
              className="link-btn icon-btn"
              onClick={() => {
                setChatOpen(true);
                markChatSeen();
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              Чат с заказчиком
              {unreadFor(b.customer_telegram_id) > 0 && (
                <span className="badge urgent" style={{ marginLeft: 6 }}>{unreadFor(b.customer_telegram_id)}</span>
              )}
            </button>
          </div>
          <div className="kv">
            <div className="k">Компания</div><div>{b.company}</div>
            <div className="k">Контакт</div><div>{b.contact_name}</div>
            <div className="k">Телефон</div><div>{b.phone}</div>
            <div className="k">Telegram</div>
            <div>
              <UserName
                id={b.customer_telegram_id}
                fallbackName={b.customer_username ? `@${b.customer_username.replace(/^@+/, "")}` : undefined}
              />
            </div>
          </div>
        </div>
      </div>

      {b.coffee_break && (
        <div className="card">
          <h3>Кофе-брейк</h3>
          <div className="kv">
            <div className="k">Кол-во кофе-брейков</div>
            <div>{b.coffee_headcount ?? "—"}</div>
            <div className="k">Что нужно</div>
            <div>
              {b.coffee_type === "other"
                ? (b.coffee_other || "Другое")
                : (COFFEE_TYPE_LABELS[b.coffee_type || "standard"] || "—")}
            </div>
            <div className="k">Гости иностранцы</div>
            <div>{b.foreign_guests ? "да — кофе-брейк в зале мероприятия" : "нет"}</div>
            <div className="k">Статус подготовки</div>
            <div>
              {admin ? (
                <select
                  value={b.coffee_status}
                  onChange={(e) => act(() => api.setCoffee(b.id, { coffee_status: e.target.value }))}
                >
                  {COFFEE_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>{COFFEE_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              ) : (
                <span className="badge coffee">{COFFEE_STATUS_LABELS[b.coffee_status] || b.coffee_status}</span>
              )}
            </div>
            <div className="k">Помещение кофе-брейка</div>
            <div>
              {b.foreign_guests ? (
                "в зале мероприятия (гости иностранцы)"
              ) : admin ? (
                <select
                  value={b.coffee_room_id ?? ""}
                  onChange={(e) =>
                    act(() => api.setCoffee(b.id, { coffee_room_id: e.target.value ? Number(e.target.value) : null }))
                  }
                >
                  <option value="">— не назначено —</option>
                  {coffeeRooms.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} (зона {r.zone_name})</option>
                  ))}
                </select>
              ) : (
                coffeeRooms.find((r) => r.id === b.coffee_room_id)?.name ??
                (b.coffee_room_id ? `#${b.coffee_room_id}` : "—")
              )}
            </div>
          </div>
          {admin && !b.foreign_guests && coffeeRooms.length === 0 && (
            <span className="field-hint">Нет помещений с кофе-брейком. Отметьте помещение как «кофе-брейк» в разделе «Помещения».</span>
          )}
        </div>
      )}

      {b.props.length > 0 && (
        <div className="card">
          <h3>Оборудование</h3>
          <table>
            <thead><tr><th>Позиция</th><th>Тип</th><th>Количество</th></tr></thead>
            <tbody>
              {b.props.map((p) => (
                <tr key={p.prop_id}>
                  <td>{p.name}</td>
                  <td><span className="badge zone">{p.kind === "office" ? "Расходники" : "Техника"}</span></td>
                  <td>{p.amount} {p.unit || "шт."}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {b.checklist.length > 0 && (
        <div className="card">
          <h3>Чек-лист подготовки</h3>
          {(() => {
            const done = b.checklist.filter((c) => c.done).length;
            const pct = Math.round((done / b.checklist.length) * 100);
            return (
              <>
                <div className="checklist-progress"><span style={{ width: `${pct}%` }} /></div>
                <span className="field-hint">Готово {done} из {b.checklist.length}</span>
                <div className="checklist" style={{ marginTop: 8 }}>
                  {b.checklist.map((it) => (
                    <label key={it.id} className={`checklist-item ${it.done ? "done" : ""}`}>
                      <input
                        type="checkbox"
                        checked={it.done}
                        disabled={!admin || busy}
                        onChange={(e) => act(() => api.toggleChecklistItem(b.id, it.id, e.target.checked))}
                      />
                      <span className="ci-text">{it.text}</span>
                    </label>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {(b.result_outcome || b.result_note) && (
        <div className="card">
          <h3>Итог мероприятия</h3>
          <div className="kv">
            <div className="k">Результат</div>
            <div>{b.result_outcome ? RESULT_OUTCOME_LABELS[b.result_outcome] || b.result_outcome : "—"}</div>
            <div className="k">Комментарий</div><div>{b.result_note || "—"}</div>
          </div>
        </div>
      )}

      {b.reject_reason && (
        <div className="card">
          <h3>Причина отклонения</h3>
          <div>{b.reject_reason}</div>
        </div>
      )}

      {b.feedback && (
        <div className="card">
          <h3>Отзыв заказчика</h3>
          <div className="kv">
            <div className="k">Общая оценка</div>
            <div><Stars value={b.feedback.rating} /></div>
            {b.feedback.room_rating != null && (
              <><div className="k">Помещение</div><div><Stars value={b.feedback.room_rating} /></div></>
            )}
            {b.feedback.service_rating != null && (
              <><div className="k">Сервис</div><div><Stars value={b.feedback.service_rating} /></div></>
            )}
            {b.feedback.props_rating != null && (
              <><div className="k">Оборудование</div><div><Stars value={b.feedback.props_rating} /></div></>
            )}
            <div className="k">Комментарий</div><div>{b.feedback.comment || "—"}</div>
          </div>
        </div>
      )}

      <div className="card">
        <h3>История статусов</h3>
        {b.status_history.length === 0 ? (
          <div className="empty">пусто</div>
        ) : (
          <table>
            <thead>
              <tr><th>Когда</th><th>Из</th><th>В</th><th>Кто</th><th>Заметка</th></tr>
            </thead>
            <tbody>
              {b.status_history.map((h) => (
                <tr key={h.id}>
                  <td>{fmt(h.created_at)}</td>
                  <td>{h.from_status ? <StatusBadge status={h.from_status} /> : "—"}</td>
                  <td><StatusBadge status={h.to_status} /></td>
                  <td>
                    {h.actor_telegram_id != null ? (
                      <UserName
                        id={h.actor_telegram_id}
                        fallbackName={
                          h.actor_telegram_id === b.customer_telegram_id && b.customer_username
                            ? `@${b.customer_username.replace(/^@+/, "")}`
                            : undefined
                        }
                      />
                    ) : "—"}
                  </td>
                  <td>{h.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canReassign && (
        <div className="card">
          <h3>Переназначить помещение</h3>
          <div className="field">
            <span className="field-hint">
              Текущее: {b.room.name} (зона {b.room.zone_name}). Перенос в другое помещение для
              балансировки загрузки — время остаётся прежним, проверяются вместимость и занятость.
            </span>
          </div>
          <div className="row2">
            <div className="field">
              <label>Новое помещение</label>
              <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                <option value="">— выберите —</option>
                {reassignRooms
                  .filter((r) => r.id !== b.room_id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} — зона {r.zone_name} (до {r.capacity} чел.)
                    </option>
                  ))}
              </select>
            </div>
            <div className="field" style={{ alignSelf: "end" }}>
              <button
                className="primary"
                disabled={busy || !reassignTo}
                onClick={() =>
                  act(async () => {
                    await api.reassign(b.id, { room_id: Number(reassignTo) });
                    setReassignTo("");
                  })
                }
              >
                Переназначить
              </button>
            </div>
          </div>
        </div>
      )}

      {admin && (
      <div className="actions">
        {canApprove && (
          <button className="primary" disabled={busy} onClick={() => act(() => api.approve(b.id))}>
            Подтвердить
          </button>
        )}
        {canReject && !rejectMode && (
          <button className="danger" disabled={busy} onClick={() => setRejectMode(true)}>
            Отклонить
          </button>
        )}
        {canComplete && !completeMode && (
          <button disabled={busy} onClick={() => setCompleteMode(true)}>
            Завершить
          </button>
        )}
        {canArchive && (
          <button disabled={busy} onClick={() => act(() => api.archive(b.id))}>
            В архив
          </button>
        )}
      </div>
      )}

      {rejectMode && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Отклонение</h3>
          <div className="field">
            <label>Причина</label>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <div className="actions">
            <button
              className="danger"
              disabled={busy || !rejectReason.trim()}
              onClick={() => act(() => api.reject(b.id, rejectReason.trim()))}
            >
              Подтвердить отклонение
            </button>
            <button onClick={() => setRejectMode(false)}>Отмена</button>
          </div>
        </div>
      )}

      {completeMode && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Завершение мероприятия</h3>
          <div className="row2">
            <div className="field">
              <label>Итог</label>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {RESULT_OUTCOME_ORDER.map((o) => (
                  <option key={o} value={o}>{RESULT_OUTCOME_LABELS[o]}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Комментарий (необязательно)</label>
              <input value={resultNote} onChange={(e) => setResultNote(e.target.value)} />
            </div>
          </div>
          <div className="actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => act(() => api.complete(b.id, { outcome, note: resultNote.trim() || null }))}
            >
              Подтвердить завершение
            </button>
            <button onClick={() => setCompleteMode(false)}>Отмена</button>
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {chatOpen && (
        <ChatModal
          telegramId={b.customer_telegram_id}
          fallbackName={b.customer_username ? `@${b.customer_username.replace(/^@+/, "")}` : undefined}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}
