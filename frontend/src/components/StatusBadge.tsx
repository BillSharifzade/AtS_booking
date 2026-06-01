import type { Status } from "../api";
import { STATUS_LABELS } from "../labels";

export default function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}>{STATUS_LABELS[status]}</span>;
}
