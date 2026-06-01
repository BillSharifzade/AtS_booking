import { useEffect, useState } from "react";
import { api, Audit } from "../api";
import UserName from "../components/UserName";
import { TableSkeleton } from "../components/Skeleton";
import { humanizeAction, humanizeTarget } from "../labels";

export default function AuditPage() {
  const [rows, setRows] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.audit().then(setRows).finally(() => setLoading(false)); }, []);
  return (
    <div>
      <h2>Журнал действий</h2>
      {loading ? (
        <TableSkeleton cols={5} rows={8} />
      ) : rows.length === 0 ? (
        <div className="empty">пусто</div>
      ) : (
        <table>
          <thead>
            <tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Объект</th><th>Детали</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString("ru-RU")}</td>
                <td><UserName id={r.actor_telegram_id} /></td>
                <td>{humanizeAction(r.action)}</td>
                <td>{humanizeTarget(r.target_type, r.target_id)}</td>
                <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.payload || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
