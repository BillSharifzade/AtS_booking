import { useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ChatMessage } from "../api";
import { isAdmin } from "../auth";
import { getCachedName, requestUser, subscribe } from "../users";

function fmtTime(dt: string) {
  return new Date(dt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ChatModal({
  telegramId,
  fallbackName,
  onClose,
}: {
  telegramId: number;
  fallbackName?: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [, force] = useReducer((x) => x + 1, 0);
  const lastId = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestUser(telegramId);
    return subscribe(force);
  }, [telegramId]);

  const name = getCachedName(telegramId) ?? fallbackName ?? null;
  const heading = name ? `${name} (ID ${telegramId})` : `ID ${telegramId}`;

  const append = (incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    lastId.current = Math.max(lastId.current, ...incoming.map((m) => m.id));
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      return [...prev, ...incoming.filter((m) => !seen.has(m.id))];
    });
  };

  useEffect(() => {
    let active = true;
    api
      .getChat(telegramId, 0)
      .then((msgs) => {
        if (!active) return;
        setMessages(msgs);
        lastId.current = msgs.reduce((m, x) => Math.max(m, x.id), 0);
      })
      .finally(() => active && setLoading(false));

    const iv = setInterval(async () => {
      try {
        const msgs = await api.getChat(telegramId, lastId.current);
        if (active) append(msgs);
      } catch {
        /* transient; next tick retries */
      }
    }, 3000);

    return () => {
      active = false;
      clearInterval(iv);
    };
  }, [telegramId]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const m = await api.sendChat(telegramId, t);
      append([m]);
      setText("");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal chat-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Чат · {heading}</h3>
          <button className="icon-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <div className="chat-body" ref={bodyRef}>
          {loading ? (
            <div className="chat-empty">Загрузка…</div>
          ) : messages.length === 0 ? (
            <div className="chat-empty">Сообщений пока нет. Напишите первым — заказчик получит сообщение в Telegram.</div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`chat-msg ${m.from_admin ? "out" : "in"}`}>
                <div className="chat-bubble">{m.text}</div>
                <div className="chat-time">{fmtTime(m.created_at)}</div>
              </div>
            ))
          )}
        </div>

        {isAdmin() ? (
          <div className="chat-input">
            <textarea
              rows={1}
              placeholder="Сообщение заказчику…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button className="primary" disabled={sending || !text.trim()} onClick={send}>
              {sending ? "…" : "Отправить"}
            </button>
          </div>
        ) : (
          <div className="chat-input"><span className="field-hint">Только просмотр — отправка сообщений доступна администраторам.</span></div>
        )}
      </div>
    </div>,
    document.body,
  );
}
