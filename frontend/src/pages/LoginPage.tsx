import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { saveAuth } from "../auth";

export default function LoginPage() {
  const nav = useNavigate();
  const [stage, setStage] = useState<"id" | "code">("id");
  const [telegramId, setTelegramId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.requestCode(parseInt(telegramId, 10));
      setStage("code");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const auth = await api.verifyCode(parseInt(telegramId, 10), code.trim());
      saveAuth(auth);
      nav("/bookings");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setStage("id");
    setCode("");
    setError(null);
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-card-head">
          <img className="auth-card-logo" src="/logo.png" alt="AtS" />
          <span className="auth-card-brand">AtS<span>Бронирование</span></span>
        </div>
        <h1>Вход в панель</h1>
        <p className="auth-sub">
          {stage === "id"
            ? "Введите ваш Telegram ID — бот пришлёт одноразовый код в личные сообщения."
            : `Введите код, отправленный в Telegram${telegramId ? ` (ID ${telegramId})` : ""}.`}
        </p>

        <div className="auth-steps">
          <span className={stage === "id" ? "on" : "done"}>1 · Telegram ID</span>
          <span className="auth-steps-line" />
          <span className={stage === "code" ? "on" : ""}>2 · Код</span>
        </div>

        {stage === "id" ? (
          <form onSubmit={requestCode}>
            <div className="field">
              <label>Telegram ID</label>
              <input
                value={telegramId}
                onChange={(e) => setTelegramId(e.target.value)}
                required
                autoFocus
                inputMode="numeric"
                pattern="[0-9]+"
                placeholder="например, 1320166360"
              />
              <span className="field-hint">Не знаете ID? Напишите боту команду /whoami.</span>
            </div>
            {error && <div className="error">{error}</div>}
            <button className="primary auth-submit" disabled={busy || !telegramId}>
              {busy ? "Отправка…" : "Получить код"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode}>
            <div className="field">
              <label>Код из Telegram</label>
              <input
                className="code-input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                autoFocus
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="••••••"
                maxLength={6}
              />
            </div>
            {error && <div className="error">{error}</div>}
            <button className="primary auth-submit" disabled={busy || code.length < 4}>
              {busy ? "Вход…" : "Войти"}
            </button>
            <button type="button" className="auth-back" onClick={back} disabled={busy}>
              ← Изменить Telegram ID
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
