import type { Status } from "./api";

export const STATUS_LABELS: Record<Status, string> = {
  new: "новая",
  processing: "в обработке",
  approved: "подтверждена",
  rejected: "отклонена",
  completed: "завершена",
  archived: "архив",
};

export const COFFEE_STATUS_LABELS: Record<string, string> = {
  pending: "ожидает",
  ready: "готов",
  served: "подан",
  not_required: "не требуется",
};
export const COFFEE_STATUS_ORDER = ["pending", "ready", "served", "not_required"];

// What's served at the coffee break (#коф).
export const COFFEE_TYPE_LABELS: Record<string, string> = {
  standard: "Стандартный (печенье, кофе, чай, конфеты)",
  other: "Другое",
};

// Seating arrangements ("Расстановка", #3).
export const ROOM_STRUCT_LABELS: Record<string, string> = {
  theatre: "Театр",
  class: "Класс",
  banquet: "Банкет",
  u_shaped: "П-образная",
};
export const ROOM_STRUCT_HINTS: Record<string, string> = {
  theatre: "Ряды стульев лицом к экрану, максимум мест",
  class: "Ряды столов со стульями, есть рабочая поверхность",
  banquet: "Группы за отдельными столами",
  u_shaped: "Столы буквой «П», экран в открытой части",
};
export const ROOM_STRUCT_ORDER = ["theatre", "class", "banquet", "u_shaped"];

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
