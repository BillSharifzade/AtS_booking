import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Review } from "../api";
import { TableSkeleton } from "../components/Skeleton";
import Stars from "../components/Stars";
import UserName from "../components/UserName";

function fmt(dt: string) {
  return new Date(dt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function avg(nums: (number | null)[]): number | null {
  const v = nums.filter((n): n is number => n != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export default function ReviewsPage() {
  const nav = useNavigate();
  const [items, setItems] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.listReviews().then(setItems).finally(() => setLoading(false)); }, []);

  const stats = useMemo(() => ({
    overall: avg(items.map((r) => r.rating)),
    room: avg(items.map((r) => r.room_rating)),
    service: avg(items.map((r) => r.service_rating)),
    props: avg(items.map((r) => r.props_rating)),
  }), [items]);

  return (
    <div>
      <div className="page-head"><h2>Отзывы</h2></div>

      {!loading && items.length > 0 && (
        <div className="metric-grid" style={{ marginBottom: 22 }}>
          {([["Общая", stats.overall], ["Помещение", stats.room], ["Сервис", stats.service], ["Оборудование", stats.props]] as const).map(([label, val]) => (
            <div key={label} className="metric-tile">
              <div className="st-label">{label}</div>
              <div className="st-value">{val != null ? val.toFixed(1) : "—"}</div>
              <div className="st-sub"><Stars value={val != null ? Math.round(val) : null} showNum={false} /></div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <TableSkeleton cols={6} rows={5} />
      ) : items.length === 0 ? (
        <div className="empty">Отзывов пока нет.</div>
      ) : (
        <table className="clickable-rows">
          <thead>
            <tr><th>Дата</th><th>Заказчик</th><th>Компания</th><th>Зал · зона</th><th>Оценки</th><th>Комментарий</th></tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.booking_id} onClick={() => nav(`/bookings/${r.booking_id}`)}>
                <td>{fmt(r.created_at)}</td>
                <td><UserName id={r.customer_telegram_id} /></td>
                <td>{r.company}</td>
                <td>{r.room} · {r.zone}</td>
                <td>
                  <div className="rev-stars">
                    <span className="review-aspect"><span className="ra-label">Общая</span><Stars value={r.rating} showNum={false} /></span>
                    <span className="review-aspect"><span className="ra-label">Зал</span><Stars value={r.room_rating} showNum={false} /></span>
                    <span className="review-aspect"><span className="ra-label">Сервис</span><Stars value={r.service_rating} showNum={false} /></span>
                    <span className="review-aspect"><span className="ra-label">Оборуд.</span><Stars value={r.props_rating} showNum={false} /></span>
                  </div>
                </td>
                <td style={{ color: "var(--muted)", maxWidth: 280 }}>{r.comment || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
