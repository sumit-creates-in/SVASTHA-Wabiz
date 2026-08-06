import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../lib/api";

type Mode = "login" | "register";

export default function Login() {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  function switchMode(m: Mode) {
    setMode(m);
    setError("");
    setName("");
    setEmail("");
    setPassword("");
    setConfirm("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (mode === "register" && password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setBusy(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const body = mode === "login" ? { email, password } : { email, password, name };
      const { token } = await api<{ token: string }>(endpoint, {
        method: "POST",
        body
      });
      setToken(token);
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-brand-900 via-emerald-800 to-brand-700">
      <form onSubmit={submit} className="card w-full max-w-sm p-8 space-y-5">
        {/* Header */}
        <div className="text-center">
          <div className="text-2xl font-bold text-brand-900">SVASTHA WABIZ</div>
          <p className="text-sm text-slate-500 mt-1">AI-powered WhatsApp Business</p>
        </div>

        {/* Tab toggle */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-medium">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`flex-1 py-2 transition-colors ${mode === "login"
                ? "bg-brand-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`flex-1 py-2 transition-colors ${mode === "register"
                ? "bg-brand-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
          >
            Create account
          </button>
        </div>

        {/* Name field — register only */}
        {mode === "register" && (
          <div>
            <label className="label">Full name</label>
            <input
              className="input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
            />
          </div>
        )}

        <div>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus={mode === "login"}
          />
        </div>

        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "register" ? 6 : undefined}
          />
        </div>

        {/* Confirm password — register only */}
        {mode === "register" && (
          <div>
            <label className="label">Confirm password</label>
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
            />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button className="btn-primary w-full justify-center" disabled={busy}>
          {busy
            ? mode === "login"
              ? "Signing in…"
              : "Creating account…"
            : mode === "login"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>
    </div>
  );
}
