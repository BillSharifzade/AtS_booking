import asyncio
import logging

from aiogram import Dispatcher
from aiogram.types import BotCommand, ErrorEvent

from app.bot.handlers import router
from app.bot.reminders import start_scheduler
from app.services.bot_texts import refresh_cache
from app.telegram import get_bot, send_text

log = logging.getLogger(__name__)

BOT_COMMANDS = [
    BotCommand(command="book", description="Новая заявка"),
    BotCommand(command="my", description="Мои заявки"),
    BotCommand(command="chat", description="Связаться с администратором"),
    BotCommand(command="cancel", description="Отменить текущий ввод"),
    BotCommand(command="whoami", description="Узнать свой Telegram ID"),
    BotCommand(command="report", description="Отчёт XLSX (для администраторов)"),
]


async def _on_error(event: ErrorEvent) -> None:
    """Last-resort safety net: log any unhandled handler error and tell the user,
    so a single bad update never silently breaks the conversation."""
    log.exception("Unhandled bot error", exc_info=event.exception)
    upd = event.update
    chat_id = None
    if upd.message is not None:
        chat_id = upd.message.chat.id
    elif upd.callback_query is not None and upd.callback_query.message is not None:
        chat_id = upd.callback_query.message.chat.id
    if chat_id is not None:
        await send_text(chat_id, "Произошла ошибка. Попробуйте ещё раз или начните заново: /book. /cancel — сброс.")


async def _run() -> None:
    logging.basicConfig(level=logging.INFO)
    bot = get_bot()
    dp = Dispatcher()
    dp.include_router(router)
    dp.errors.register(_on_error)
    await refresh_cache()  # load admin text overrides before serving
    await bot.set_my_commands(BOT_COMMANDS)
    start_scheduler()
    await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
