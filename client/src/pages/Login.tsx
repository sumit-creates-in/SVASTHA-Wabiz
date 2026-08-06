import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { token } = await api<{ token: string }>("/auth/login", {
        method: "POST",
        body: { email, password }
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
        <div className="text-center">
          <div className="text-2xl font-bold text-brand-900">SVASTHA WABIZ</div>
          <p className="text-sm text-slate-500 mt-1">AI-powered WhatsApp Business</p>
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full justify-center" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
