import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { api, Booking, Status } from "../api";
import { RESULT_OUTCOME_LABELS, RESULT_OUTCOME_ORDER, STATUS_LABELS } from "../labels";
import { TableSkeleton } from "./Skeleton";
import { useNotifications } from "../notifications";

const COLUMNS: { status: Status; label: string }[] = [
  { status: "new", label: "Новые" },
  { status: "approved", label: "Подтверждены" },
  { status: "completed", label: "Завершены" },
  { status: "rejected", label: "Отклонены" },
  { status: "archived", label: "Архив" },
];

// Only transitions that have a corresponding API action are draggable targets.
const TRANSITIONS: Record<Status, Status[]> = {
  new: ["approved", "rejected"],
  processing: ["approved", "rejected"],
  approved: ["completed", "rejected"],
  completed: ["archived"],
  rejected: ["archived"],
  archived: [],
};

function fmt(dt: string) {
  return new Date(dt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

function CardBody({ booking, dragging }: { booking: Booking; dragging?: boolean }) {
  const { unreadFor } = useNotifications();
  const unread = unreadFor(booking.customer_telegram_id);
  return (
    <div className={`kanban-card ${dragging ? "dragging" : ""}`}>
      <div className="kanban-card-top">
        <span className="kanban-id">№{booking.id}</span>
        {booking.is_urgent && booking.status !== "archived" && <span className="badge urgent">срочно</span>}
      </div>
      <div className="kanban-title">{booking.event_name}</div>
      <div className="kanban-meta">{booking.company}</div>
      <div className="kanban-meta">{fmt(booking.starts_at)} · {booking.attendees} чел.</div>
      {unread > 0 && (
        <span className="chat-dot" title="Новые сообщения">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z" /></svg>
          {unread}
        </span>
      )}
    </div>
  );
}

function DraggableCard({ booking }: { booking: Booking }) {
  const nav = useNavigate();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: booking.id });
  return (
    <div className="kanban-card-wrap" style={{ opacity: isDragging ? 0 : 1 }}>
      <div ref={setNodeRef} {...attributes} {...listeners} className="kanban-drag-surface">
        <CardBody booking={booking} />
      </div>
      <button className="kanban-open" onClick={() => nav(`/bookings/${booking.id}`)}>Открыть →</button>
    </div>
  );
}

const COLLAPSED_LIMIT = 5;

function Column({ status, label, items }: { status: Status; label: string; items: Booking[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [expanded, setExpanded] = useState(false);
  // Columns like "Архив" can grow huge — show at most 5 until expanded.
  const visible = expanded ? items : items.slice(0, COLLAPSED_LIMIT);
  const hidden = items.length - visible.length;
  return (
    <div className="kanban-col">
      <div className="kanban-col-head">
        <span>{label}</span>
        <span className="kanban-count">{items.length}</span>
      </div>
      <div ref={setNodeRef} className={`kanban-col-body ${isOver ? "over" : ""}`}>
        {visible.map((b) => <DraggableCard key={b.id} booking={b} />)}
        {items.length === 0 && <div className="kanban-col-empty">—</div>}
        {hidden > 0 && (
          <button className="kanban-more" onClick={() => setExpanded(true)}>Показать ещё {hidden}</button>
        )}
        {expanded && items.length > COLLAPSED_LIMIT && (
          <button className="kanban-more" onClick={() => setExpanded(false)}>Свернуть</button>
        )}
      </div>
    </div>
  );
}

export default function KanbanBoard({ refreshToken }: { refreshToken: number }) {
  const [items, setItems] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [reject, setReject] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [complete, setComplete] = useState<number | null>(null);
  const [cOutcome, setCOutcome] = useState("held");
  const [cNote, setCNote] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = () => api.listBookings({}).then(setItems).finally(() => setLoading(false));
  useEffect(() => { load(); }, [refreshToken]);

  const grouped = useMemo(() => {
    const map: Record<string, Booking[]> = {};
    for (const c of COLUMNS) map[c.status] = [];
    for (const b of items) (map[b.status] ??= []).push(b);
    return map;
  }, [items]);

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3200);
  };

  const apply = async (id: number, to: Status, call: () => Promise<unknown>) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status: to } : x)));
    try {
      await call();
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      await load();
    }
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(Number(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const id = Number(active.id);
    const b = items.find((x) => x.id === id);
    if (!b) return;
    const to = String(over.id) as Status;
    if (b.status === to) return;
    if (!TRANSITIONS[b.status]?.includes(to)) {
      showToast(`Нельзя перенести «${STATUS_LABELS[b.status]}» → «${STATUS_LABELS[to]}».`);
      return;
    }
    if (to === "approved") void apply(id, to, () => api.approve(id));
    else if (to === "archived") void apply(id, to, () => api.archive(id));
    else if (to === "completed") { setComplete(id); setCOutcome("held"); setCNote(""); }
    else if (to === "rejected") { setReject(id); setReason(""); }
  };

  const confirmReject = () => {
    if (reject == null) return;
    const r = reason.trim();
    if (!r) return;
    const id = reject;
    setReject(null);
    void apply(id, "rejected", () => api.reject(id, r));
  };

  const confirmComplete = () => {
    if (complete == null) return;
    const id = complete;
    setComplete(null);
    void apply(id, "completed", () => api.complete(id, { outcome: cOutcome, note: cNote.trim() || null }));
  };

  const activeBooking = activeId != null ? items.find((b) => b.id === activeId) : null;

  if (loading) return <TableSkeleton cols={6} rows={4} />;

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="kanban">
          {COLUMNS.map((c) => (
            <Column key={c.status} status={c.status} label={c.label} items={grouped[c.status] ?? []} />
          ))}
        </div>
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {activeBooking ? <CardBody booking={activeBooking} dragging /> : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>

      {toast && <div className="kanban-toast">{toast}</div>}

      {reject != null && createPortal(
        <div className="modal-overlay" onClick={() => setReject(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Отклонить заявку №{reject}</h3>
              <button className="icon-close" onClick={() => setReject(null)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Причина отклонения</label>
                <textarea rows={3} value={reason} autoFocus onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setReject(null)}>Отмена</button>
              <button className="danger" disabled={!reason.trim()} onClick={confirmReject}>Отклонить</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {complete != null && createPortal(
        <div className="modal-overlay" onClick={() => setComplete(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Завершить заявку №{complete}</h3>
              <button className="icon-close" onClick={() => setComplete(null)} aria-label="Закрыть">✕</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>Итог</label>
                <select value={cOutcome} autoFocus onChange={(e) => setCOutcome(e.target.value)}>
                  {RESULT_OUTCOME_ORDER.map((o) => (
                    <option key={o} value={o}>{RESULT_OUTCOME_LABELS[o]}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Комментарий (необязательно)</label>
                <textarea rows={2} value={cNote} onChange={(e) => setCNote(e.target.value)} />
              </div>
            </div>
            <div className="modal-foot">
              <button onClick={() => setComplete(null)}>Отмена</button>
              <button className="primary" onClick={confirmComplete}>Завершить</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
