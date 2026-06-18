import type { RoomStruct } from "../api";

// SVG seating diagrams matching the admin panel (Театр/Класс/Банкет/П-образная).
const VB_W = 200;
const VB_H = 150;

function Screen() {
  return (
    <g>
      <rect x={56} y={8} width={88} height={15} rx={5} className="rsd-screen" />
      <text x={100} y={19} className="rsd-screen-label" textAnchor="middle">ЭКРАН</text>
    </g>
  );
}
function seat(x: number, y: number, key: string | number) {
  return <circle key={key} cx={x} cy={y} r={3.4} className="rsd-seat" />;
}
function Theatre() {
  const rows = [40, 60, 80, 100, 120];
  const cols = [30, 44, 58, 72, 128, 142, 156, 170];
  const seats: JSX.Element[] = [];
  rows.forEach((y, ri) => cols.forEach((x, ci) => seats.push(seat(x, y, `${ri}-${ci}`))));
  return <>{seats}</>;
}
function ClassRoom() {
  const rows = [44, 72, 100, 128];
  const out: JSX.Element[] = [];
  rows.forEach((y, ri) => {
    out.push(<rect key={`d${ri}l`} x={28} y={y} width={60} height={7} rx={2.5} className="rsd-table" />);
    out.push(<rect key={`d${ri}r`} x={112} y={y} width={60} height={7} rx={2.5} className="rsd-table" />);
    [38, 58, 78].forEach((x, ci) => out.push(seat(x, y + 16, `${ri}-l${ci}`)));
    [122, 142, 162].forEach((x, ci) => out.push(seat(x, y + 16, `${ri}-r${ci}`)));
  });
  return <>{out}</>;
}
function Banquet() {
  const tables = [[62, 58], [138, 58], [62, 115], [138, 115]];
  const out: JSX.Element[] = [];
  tables.forEach(([cx, cy], ti) => {
    out.push(<circle key={`t${ti}`} cx={cx} cy={cy} r={16} className="rsd-table-round" />);
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8;
      out.push(seat(cx + Math.cos(a) * 24, cy + Math.sin(a) * 24, `${ti}-${i}`));
    }
  });
  return <>{out}</>;
}
function UShaped() {
  const out: JSX.Element[] = [];
  out.push(<rect key="tl" x={40} y={40} width={9} height={78} rx={3} className="rsd-table" />);
  out.push(<rect key="tr" x={151} y={40} width={9} height={78} rx={3} className="rsd-table" />);
  out.push(<rect key="tb" x={40} y={118} width={120} height={9} rx={3} className="rsd-table" />);
  [48, 68, 88, 108].forEach((y, i) => out.push(seat(28, y, `l${i}`)));
  [48, 68, 88, 108].forEach((y, i) => out.push(seat(172, y, `r${i}`)));
  [62, 84, 106, 138].forEach((x, i) => out.push(seat(x, 138, `b${i}`)));
  return <>{out}</>;
}
const SHAPES: Record<RoomStruct, () => JSX.Element> = {
  theatre: Theatre, class: ClassRoom, banquet: Banquet, u_shaped: UShaped,
};

export default function RoomStructDiagram({ struct }: { struct: RoomStruct }) {
  const Shape = SHAPES[struct];
  return (
    <svg className="rsd" viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label={struct}>
      <Screen />
      {Shape && <Shape />}
    </svg>
  );
}
