import type { RoomStruct } from "../api";
import { ROOM_STRUCT_HINTS, ROOM_STRUCT_LABELS, ROOM_STRUCT_ORDER } from "../labels";
import RoomStructDiagram from "./RoomStructDiagram";

// Reusable seating-arrangement picker (#3). Used in the admin booking form and the
// client mini app. `value` may be null (nothing chosen yet).
export default function RoomStructPicker({
  value,
  onChange,
}: {
  value: RoomStruct | null;
  onChange: (v: RoomStruct) => void;
}) {
  return (
    <div className="struct-grid">
      {ROOM_STRUCT_ORDER.map((s) => (
        <button
          key={s}
          type="button"
          className={`struct-card ${value === s ? "on" : ""}`}
          onClick={() => onChange(s as RoomStruct)}
        >
          <RoomStructDiagram struct={s as RoomStruct} />
          <span className="struct-name">{ROOM_STRUCT_LABELS[s]}</span>
          <span className="struct-hint">{ROOM_STRUCT_HINTS[s]}</span>
        </button>
      ))}
    </div>
  );
}
