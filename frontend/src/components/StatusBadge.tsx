import type { Status } from "../api";
import { STATUS_LABELS } from "../labels";

export default function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge ${status}`}>
      {status === "approved" && <span aria-hidden style={{ marginRight: 4 }}>✓</span>}
      {STATUS_LABELS[status]}
    </span>
  );
}
