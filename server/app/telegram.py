import html

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramAPIError
from aiogram.types import BufferedInputFile

from app.config import settings

_bot: Bot | None = None


def esc(value) -> str:
    """Escape user-supplied content before interpolating into HTML-parsed messages."""
    return html.escape(str(value)) if value is not None else ""


def get_bot() -> Bot:
    global _bot
    if _bot is None:
        _bot = Bot(
            token=settings.telegram_bot_token,
            default=DefaultBotProperties(parse_mode=ParseMode.HTML),
        )
    return _bot


async def send_text(chat_id: int, text: str) -> None:
    try:
        await get_bot().send_message(chat_id=chat_id, text=text)
    except TelegramAPIError:
        # Don't crash flow on notification failure; surface in logs only.
        import logging
        logging.getLogger(__name__).exception("telegram send failed chat=%s", chat_id)


async def send_document(chat_id: int, data: bytes, filename: str, caption: str | None = None) -> bool:
    """Send in-memory bytes as a document. Returns True on success (logs on failure)."""
    try:
        await get_bot().send_document(
            chat_id=chat_id,
            document=BufferedInputFile(data, filename=filename),
            caption=caption,
        )
        return True
    except TelegramAPIError:
        import logging
        logging.getLogger(__name__).exception("telegram send_document failed chat=%s", chat_id)
        return False
