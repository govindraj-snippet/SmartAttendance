import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { QrCode, Mail, Lock, User, GraduationCap, Users, Loader2, ShieldCheck, Zap, BarChart3 } from "lucide-react";
import api, { errMsg } from "./api";

export default function Login() {
  const nav = useNavigate();
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ name: "", email: "", password: "", role: "STUDENT" });
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      if (mode === "register") {
        await api.post("/auth/register", f);
        setMode("login");
        setMsg({ type: "ok", text: "Account created! Please log in." });
      } else {
        const { data } = await api.post("/auth/login", { email: f.email, password: f.password });
        localStorage.setItem("token", data.token);
        localStorage.setItem("role", data.role);
        localStorage.setItem("name", data.name);
        nav(data.role === "TEACHER" ? "/teacher" : "/student");
      }
    } catch (err) {
      setMsg({ type: "error", text: errMsg(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="logo" style={{ color: "#fff" }}>
          <div className="logo-mark" style={{ background: "rgba(255,255,255,.2)" }}><QrCode size={20} /></div>
          QR Attendance
        </div>
        <h1>Attendance in one scan.</h1>
        <p>Teachers show a live QR code. Students scan it with their phone. No paper, no roll calls.</p>
        <div className="hero-points">
          <div><Zap /> Marked in under 2 seconds</div>
          <div><ShieldCheck /> QR refreshes every 10s, so shared photos won't work</div>
          <div><BarChart3 /> Live list of who's present</div>
        </div>
      </section>

      <section className="auth-panel">
        <form className="card auth-card" onSubmit={submit}>
          <div className="logo"><div className="logo-mark"><QrCode size={20} /></div>QR Attendance</div>
          <h2>{mode === "login" ? "Welcome back" : "Create account"}</h2>
          <p className="muted">{mode === "login" ? "Log in to continue" : "Join as a teacher or student"}</p>

          <div className="tabs">
            <button type="button" className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setMsg(null); }}>Login</button>
            <button type="button" className={mode === "register" ? "on" : ""} onClick={() => { setMode("register"); setMsg(null); }}>Register</button>
          </div>

          {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

          {mode === "register" && (
            <>
              <div className="role-pick">
                <button type="button" className={f.role === "STUDENT" ? "on" : ""} onClick={() => setF({ ...f, role: "STUDENT" })}>
                  <GraduationCap /> Student
                </button>
                <button type="button" className={f.role === "TEACHER" ? "on" : ""} onClick={() => setF({ ...f, role: "TEACHER" })}>
                  <Users /> Teacher
                </button>
              </div>
              <div className="field">
                <User size={17} />
                <input className="input" placeholder="Full name" value={f.name} onChange={set("name")} required />
              </div>
            </>
          )}

          <div className="field">
            <Mail size={17} />
            <input className="input" type="email" placeholder="Email" value={f.email} onChange={set("email")} required />
          </div>
          <div className="field">
            <Lock size={17} />
            <input className="input" type="password" placeholder="Password" value={f.password} onChange={set("password")} required minLength={6} />
          </div>

          <button className="btn btn-primary btn-block" disabled={loading}>
            {loading && <Loader2 size={17} className="spin" />}
            {mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
      </section>
    </div>
  );
}
