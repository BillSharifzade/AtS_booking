// Display-only star rating (reuses .rating-stars styling). For interactive input
// in forms/mini-app, pass onChange to make stars clickable.
export default function Stars({
  value,
  max = 5,
  showNum = true,
  onChange,
}: {
  value: number | null;
  max?: number;
  showNum?: boolean;
  onChange?: (v: number) => void;
}) {
  if (value == null && !onChange) return <span className="rating-num">—</span>;
  const v = value ?? 0;
  if (onChange) {
    return (
      <span className="rating-stars" role="radiogroup">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className="star-btn"
            aria-label={`${n}`}
            onClick={() => onChange(n)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 22, lineHeight: 1, color: n <= v ? "#e0a400" : "var(--border-strong)" }}
          >
            ★
          </button>
        ))}
      </span>
    );
  }
  return (
    <span className="rating-stars">
      <span className="stars-on">{"★".repeat(v)}</span>
      <span className="stars-off">{"★".repeat(max - v)}</span>
      {showNum && <span className="rating-num">{v}/{max}</span>}
    </span>
  );
}
