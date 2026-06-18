import type { RoomStruct, Status } from "./api";

export const ROOM_STRUCT_LABELS: Record<RoomStruct, string> = {
  theatre: "Театр",
  class: "Класс",
  banquet: "Банкет",
  u_shaped: "П-образная",
};
export const ROOM_STRUCT_HINTS: Record<RoomStruct, string> = {
  theatre: "Ряды стульев лицом к экрану",
  class: "Ряды столов со стульями",
  banquet: "Группы за отдельными столами",
  u_shaped: "Столы буквой «П», экран впереди",
};
export const ROOM_STRUCT_ORDER: RoomStruct[] = ["theatre", "class", "banquet", "u_shaped"];

export const STATUS_LABELS: Record<Status, string> = {
  new: "новая",
  processing: "в обработке",
  approved: "подтверждена",
  rejected: "отклонена",
  completed: "завершена",
  archived: "архив",
};
export const STATUS_TONE: Record<Status, string> = {
  new: "blue",
  processing: "amber",
  approved: "green",
  rejected: "red",
  completed: "slate",
  archived: "muted",
};
