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

// Requester grade ("Грейд", #1) — fixed dropdown, order mirrors the backend GRADES.
export const GRADES = [
  "Стажер",
  "Специалист",
  "Ведущий специалист",
  "Главный специалист",
  "Руководитель отдела",
  "Руководитель департамента",
];

// Participation-rules acknowledgement (#4). Files/links are placeholders until the
// real documents are supplied — edit RULES_LINKS to point at the actual URLs.
export const RULES_INTRO =
  "Мероприятия AtS созданы для развития и повышения профессиональных и личностных навыков " +
  "сотрудников, для раскрытия потенциала, усиления командного духа, а также мотивации и " +
  "вовлечённости сотрудников. Чтобы участие было максимально эффективным и комфортным для всех, " +
  "просим соблюдать несколько простых, но важных правил. Пожалуйста, ознакомьтесь и ознакомьте " +
  "Ваших сотрудников с рекомендациями и укажите, что ознакомились.";
export const RULES_RECOMMENDATIONS_URL = "https://drive.google.com/file/d/16_I5HowLA_bQF7AafkmcIU0Mt2Q2k72q/view";
export const RULES_LINKS: { label: string; url: string }[] = [
  { label: 'Ознакомился с файлом «Заметка для Компании-Участника мероприятий AtS»', url: "#" },
  { label: 'Ознакомился с файлом «Правила нахождения сотрудников в мероприятиях в "AtS Space"»', url: "#" },
];

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
