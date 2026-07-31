// Shared tokens for every chart in the panel, so the whole dashboard reads as one
// system. Values mirror the CSS custom properties in styles.css — Recharts needs
// concrete colours (SVG attributes), it can't resolve var().

export const VIZ = {
  surface: "#ffffff",
  grid: "#e7e9ee",
  axis: "#9aa0ab",
  ink: "#14161a",
  muted: "#707684",
  accent: "#2a5bd7",
  accentDeep: "#16367f",
  accentSoft: "#eef3fe",
};

/**
 * Categorical slots, assigned in fixed order and never cycled.
 *
 * Validated with the dataviz palette validator (light mode, surface #ffffff):
 * lightness band PASS · chroma floor PASS · adjacent CVD ΔE 9.1 PASS ·
 * normal-vision ΔE 19.6 PASS. Contrast against the surface WARNs for the lighter
 * slots, so every categorical chart here ships direct labels **and** a legend —
 * identity is never carried by colour alone.
 */
export const CATEGORICAL = ["#2a5bd7", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];

/** Reserved status colours — never reused as a categorical slot. */
export const STATUS_COLORS: Record<string, string> = {
  new: "#2a5bd7",
  processing: "#9a6b00",
  approved: "#1f7a44",
  completed: "#4a5160",
  rejected: "#b3261e",
  archived: "#c3c7cf",
};

/** Axis/grid props shared by the cartesian charts. */
export const AXIS = {
  tick: { fill: VIZ.axis, fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const ru = (n: number) => n.toLocaleString("ru-RU");

/** Recharts 3 hands `LabelList` formatters a `RenderableText` (string|number|null|undefined). */
export const asNum = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));

/** 1 заявка · 2 заявки · 5 заявок */
export function pluralBookings(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "заявка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "заявки";
  return "заявок";
}
