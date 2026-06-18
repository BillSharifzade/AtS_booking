// Interactive or display star rating.
export default function Stars({
  value,
  onChange,
  size = 30,
}: {
  value: number | null;
  onChange?: (v: number) => void;
  size?: number;
}) {
  const v = value ?? 0;
  return (
    <span className="stars" role={onChange ? "radiogroup" : undefined}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          aria-label={`${n}`}
          onClick={() => onChange?.(n)}
          className="star"
          style={{ fontSize: size, color: n <= v ? "#f5a400" : "var(--border-strong)", cursor: onChange ? "pointer" : "default" }}
        >
          ★
        </button>
      ))}
    </span>
  );
}
