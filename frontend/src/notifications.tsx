import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";

type NotificationsValue = {
  pendingBookings: number;
  newMessages: number;
  unreadByUser: Record<string, number>;
  unreadFor: (telegramId: number) => number;
  markChatSeen: () => void;
};

const Ctx = createContext<NotificationsValue>({
  pendingBookings: 0,
  newMessages: 0,
  unreadByUser: {},
  unreadFor: () => 0,
  markChatSeen: () => {},
});

export const useNotifications = () => useContext(Ctx);

const SEEN_KEY = "ats_seen_chat_id";
const POLL_MS = 12000;

let audioCtx: AudioContext | null = null;

/** A calm two-note sine chime via Web Audio — no asset file, low volume. */
function playChime() {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = audioCtx || new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const now = audioCtx.currentTime;
    const gain = audioCtx.createGain();
    gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.1, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    [659.25, 880].forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(now + i * 0.13);
      osc.stop(now + 0.9);
    });
  } catch {
    /* audio unavailable / blocked — ignore */
  }
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [pendingBookings, setPendingBookings] = useState(0);
  const [newMessages, setNewMessages] = useState(0);
  const [unreadByUser, setUnreadByUser] = useState<Record<string, number>>({});

  const seenChatId = useRef(Number(localStorage.getItem(SEEN_KEY) || 0));
  const latestChatId = useRef(0);
  const prevBookingId = useRef<number | null>(null);
  const prevNewMessages = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const n = await api.notifications(seenChatId.current);
        if (!active) return;
        latestChatId.current = n.latest_chat_id;
        setPendingBookings(n.pending_bookings);
        setNewMessages(n.new_messages);
        setUnreadByUser(n.unread_by_user);

        const firstRun = prevBookingId.current === null;
        const bookingArrived = !firstRun && n.latest_booking_id > (prevBookingId.current ?? 0);
        const messageArrived = !firstRun && n.new_messages > (prevNewMessages.current ?? 0);
        if (bookingArrived || messageArrived) playChime();
        prevBookingId.current = n.latest_booking_id;
        prevNewMessages.current = n.new_messages;
      } catch {
        /* transient; retry next tick */
      }
    };

    poll();
    const iv = setInterval(poll, POLL_MS);
    // Browsers require a user gesture before audio — unlock on first interaction.
    const unlock = () => {
      try {
        void audioCtx?.resume();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });

    return () => {
      active = false;
      clearInterval(iv);
      window.removeEventListener("pointerdown", unlock);
    };
  }, []);

  const markChatSeen = () => {
    seenChatId.current = latestChatId.current;
    localStorage.setItem(SEEN_KEY, String(seenChatId.current));
    prevNewMessages.current = 0;
    setNewMessages(0);
    setUnreadByUser({});
  };

  const unreadFor = (telegramId: number) => unreadByUser[String(telegramId)] ?? 0;

  return (
    <Ctx.Provider value={{ pendingBookings, newMessages, unreadByUser, unreadFor, markChatSeen }}>
      {children}
    </Ctx.Provider>
  );
}
