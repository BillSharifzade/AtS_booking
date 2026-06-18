from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    telegram_bot_token: str = Field(alias="TELEGRAM_BOT_TOKEN")
    admin_telegram_ids_raw: str = Field(default="", alias="ADMIN_TELEGRAM_IDS")
    sat_bookings_group_chat_id: int = Field(alias="SAT_BOOKINGS_GROUP_CHAT_ID")

    jwt_secret: str = Field(alias="JWT_SECRET")
    jwt_ttl_hours: int = Field(default=12, alias="JWT_TTL_HOURS")
    login_code_ttl_seconds: int = Field(default=300, alias="LOGIN_CODE_TTL_SECONDS")

    database_url: str = Field(alias="DATABASE_URL")

    cors_origins_raw: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")

    # Public HTTPS URL of the client Telegram Mini Web App (#13). When set, the bot
    # exposes a "launch app" menu/inline button. Must be HTTPS (Telegram requirement);
    # apex koinotinav.com is taken, so this lives at the dchr. subdomain.
    miniapp_url: str = Field(default="", alias="MINIAPP_URL")

    @property
    def admin_telegram_ids(self) -> set[int]:
        return {int(x.strip()) for x in self.admin_telegram_ids_raw.split(",") if x.strip()}

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins_raw.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
