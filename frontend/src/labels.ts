import type { Status } from "./api";

export const STATUS_LABELS: Record<Status, string> = {
  new: "новая",
  processing: "в обработке",
  approved: "Подтверждён",
  rejected: "отклонена",
  completed: "завершена",
  archived: "архив",
};

// Event formats ("Тип мероприятия") — fixed dropdown, mirrors backend EVENT_TYPES.
export const EVENT_TYPES = [
  "Тренинг",
  "Воркшоп",
  "Модуль",
  "Презентация",
  "Собрание",
  "Мастер-класс",
];

// Whether a booking must state the requester's департамент/отдел. Admins set this per
// company (Компании → «Спрашивать департамент»); the name check below is only a
// fallback for a company typed by hand, and mirrors the backend `is_koinoti`.
const KOINOTI_RE = /ко[ий]?ноти\s*нав|koinoti\s*nav/i;
export const isKoinoti = (company: string): boolean => KOINOTI_RE.test(company || "");
export const needsDepartment = (
  company: { requires_department?: boolean } | null | undefined,
  companyName: string,
): boolean => (company ? !!company.requires_department : isKoinoti(companyName));

export const COFFEE_STATUS_LABELS: Record<string, string> = {
  pending: "ожидает",
  ready: "готов",
  served: "подан",
  not_required: "не требуется",
};
export const COFFEE_STATUS_ORDER = ["pending", "ready", "served", "not_required"];

// What's served at the coffee break (#коф). "other" is offered in VIP rooms only and
// is a fixed set — COFFEE_OTHER_VIP mirrors services/bookings.py.
export const COFFEE_OTHER_VIP = "Конфеты, сухофрукты, вода 0,5 л";
export const COFFEE_TYPE_LABELS: Record<string, string> = {
  standard: "Стандартный (печенье, кофе, чай, конфеты)",
  other: COFFEE_OTHER_VIP,
};

// Seating arrangements ("Расстановка", #3).
export const ROOM_STRUCT_LABELS: Record<string, string> = {
  theatre: "Театр",
  class: "Класс",
  banquet: "Банкет",
  u_shaped: "П-образная",
  conference: "Конференц",
};
export const ROOM_STRUCT_HINTS: Record<string, string> = {
  theatre: "Ряды стульев лицом к экрану, максимум мест",
  class: "Ряды столов со стульями, есть рабочая поверхность",
  banquet: "Группы за отдельными столами",
  u_shaped: "Столы буквой «П», экран в открытой части",
  conference: "Длинный стол, по 5 стульев с каждой стороны, экран в начале",
};
export const ROOM_STRUCT_ORDER = ["theatre", "class", "banquet", "u_shaped", "conference"];

// Requester grade ("Грейд заявителя", #1) — fixed dropdown, order mirrors the backend
// GRADES. The two «Руководитель отдела/департамента» entries are merged into one.
export const GRADES = [
  "Стажер",
  "Специалист",
  "Ведущий специалист",
  "Главный специалист",
  "Руководитель структурного подразделения",
];

export const RESULT_OUTCOME_LABELS: Record<string, string> = {
  held: "Состоялось",
  partial: "Состоялось частично",
  cancelled: "Отменено заказчиком",
};
export const RESULT_OUTCOME_ORDER = ["held", "partial", "cancelled"];

const AUDIT_ACTION_LABELS: Record<string, string> = {
  "booking.create": "Создание заявки",
  "booking.approve": "Подтверждение заявки",
  "booking.reject": "Отклонение заявки",
  "booking.complete": "Завершение мероприятия",
  "booking.archive": "Архивация заявки",
  "booking.delete": "Удаление заявки из архива",
  "booking.reassign": "Перенос помещения",
  "booking.coffee": "Кофе-брейк: подготовка",
  "panel_user.add": "Добавление наблюдателя",
  "panel_user.remove": "Удаление наблюдателя",
  "report.export": "Выгрузка отчёта",
  "room.create": "Создание помещения",
  "room.update": "Изменение помещения",
  "room.deactivate": "Скрытие помещения",
  "room.images_add": "Добавление фото помещения",
  "room.images_remove": "Удаление фото помещения",
  "zone.create": "Создание зоны",
  "zone.update": "Изменение зоны",
  "zone.delete": "Удаление зоны",
  "bottext.update": "Изменение текста бота",
  "chat.send": "Сообщение в чате",
  "auth.login": "Вход в систему",
};

export function humanizeAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

const TARGET_TYPE_LABELS: Record<string, string> = {
  booking: "Заявка",
  room: "Помещение",
  zone: "Зона",
  bottext: "Текст бота",
  chat: "Чат",
};

export function humanizeTarget(type: string | null, id: number | null): string {
  if (!type) return "—";
  const label = TARGET_TYPE_LABELS[type] ?? type;
  return id != null ? `${label} №${id}` : label;
}
