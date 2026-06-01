import { useEffect, useReducer, useState } from "react";
import { getCachedName, requestUser, subscribe } from "../users";

const EyeIcon = ({ off }: { off: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
    {off && <line x1="3" y1="3" x2="21" y2="21" />}
  </svg>
);

/**
 * Shows a Telegram user's name with an eye button that reveals the raw ID.
 * Display priority: resolved name → fallbackName (e.g. stored @username) → bare ID.
 * The eye only appears when there's a name distinct from the ID to toggle.
 */
export default function UserName({
  id,
  fallbackName,
}: {
  id: number | null | undefined;
  fallbackName?: string;
}) {
  const [, force] = useReducer((x) => x + 1, 0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (id == null) return;
    requestUser(id);
    return subscribe(force);
  }, [id]);

  if (id == null) return <span className="muted-dash">—</span>;

  const display = getCachedName(id) ?? fallbackName ?? null;

  // Nothing to hide — just show the ID, no eye.
  if (display == null) return <span>ID {id}</span>;

  return (
    <span className="username">
      <span>{revealed ? `ID ${id}` : display}</span>
      <button
        type="button"
        className="reveal-btn"
        title={revealed ? "Скрыть Telegram ID" : "Показать Telegram ID"}
        aria-label={revealed ? "Скрыть Telegram ID" : "Показать Telegram ID"}
        onClick={() => setRevealed((r) => !r)}
      >
        <EyeIcon off={revealed} />
      </button>
    </span>
  );
}
