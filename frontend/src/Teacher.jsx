import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Radio, StopCircle, Loader2, QrCode, Download, BookOpen, FileSpreadsheet } from "lucide-react";
import api, { errMsg } from "./api";

const utc = (t) => new Date(t.endsWith("Z") ? t : t + "Z");
const initials = (n) => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const fmtTime = (t) => utc(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtDate = (t) => utc(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export default function Teacher() {
  const [title, setTitle] = useState("");
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [token, setToken] = useState("");
  const [present, setPresent] = useState([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);

  const active = sessions.find((s) => s.id === activeId);

  const refresh = async () => {
    try {
      const { data } = await api.get("/teacher/sessions");
      setSessions(data);
      return data;
    } catch (e) {
      setMsg({ type: "error", text: errMsg(e) });
    }
  };

  // On page load: resume a live session if there is one
  useEffect(() => {
    refresh().then((data) => {
      const live = data?.find((s) => s.active);
      if (live) setActiveId(live.id);
    });
  }, []);

  // Refresh QR every 10s and the present list every 4s
  useEffect(() => {
    if (!activeId) return;
    let alive = true;

    const loadQr = async () => {
      try {
        const { data } = await api.get(`/teacher/sessions/${activeId}/qr`);
        if (alive) setToken(data.token);
      } catch (e) {
        if ([404, 410].includes(e.response?.status) && alive) { setActiveId(null); setToken(""); refresh(); }
      }
    };
    const loadPresent = async () => {
      try {
        const { data } = await api.get(`/teacher/sessions/${activeId}/attendance`);
        if (alive) setPresent(data);
      } catch { /* next tick retries */ }
    };

    loadQr(); loadPresent();
    const a = setInterval(loadQr, 10000);
    const b = setInterval(loadPresent, 4000);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, [activeId]);

  const run = async (name, fn) => {
    setBusy(name); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ type: "error", text: errMsg(e) }); }
    setBusy("");
  };

  const start = (e) => {
    e.preventDefault();
    run("start", async () => {
      const { data } = await api.post("/teacher/sessions", { title });
      setPresent([]); setToken(""); setTitle("");
      await refresh();
      setActiveId(data.sessionId);
    });
  };

  const end = () =>
    run("end", async () => {
      await api.post(`/teacher/sessions/${activeId}/end`);
      setActiveId(null); setToken("");
      await refresh();
      setMsg({ type: "ok", text: "Session ended. You can download the attendance sheet below." });
    });

  const download = (s) =>
    run("dl" + s.id, async () => {
      const { data } = await api.get(`/teacher/sessions/${s.id}/export`, {
        params: { tz: -new Date().getTimezoneOffset() },
        responseType: "blob",
      });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      const day = utc(s.startedAt).toISOString().slice(0, 10);
      a.href = url;
      a.download = `${s.title.replace(/[^\w\- ]+/g, "").trim() || "attendance"}-${day}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    });

  return (
    <>
      <div className="page-head">
        <h1>Teacher dashboard</h1>
        <p className="muted">Start a session, show the QR, and download who scanned it.</p>
      </div>

      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <div className="grid-2">
        {/* LEFT: control + history */}
        <div>
          <div className="card">
            <div className="card-title"><BookOpen size={20} /> {active ? "Session in progress" : "New attendance session"}</div>
            {active ? (
              <>
                <b>{active.title}</b>
                <p className="muted" style={{ margin: "4px 0 16px" }}>Started {fmtDate(active.startedAt)}</p>
                <div className="row">
                  <button className="btn btn-danger" style={{ flex: 1 }} onClick={end} disabled={busy === "end"}>
                    <StopCircle size={17} /> End session
                  </button>
                  <button className="btn btn-ghost" onClick={() => download(active)} disabled={busy === "dl" + active.id}>
                    <Download size={16} /> Download
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={start}>
                <div className="field">
                  <BookOpen size={17} />
                  <input className="input" placeholder="e.g. Java - Section A, Lecture 5" value={title} onChange={(e) => setTitle(e.target.value)} required />
                </div>
                <button className="btn btn-primary btn-block" disabled={busy === "start"}>
                  {busy === "start" ? <Loader2 size={17} className="spin" /> : <Radio size={17} />} Start attendance
                </button>
              </form>
            )}
          </div>

          <div className="card">
            <div className="card-title"><FileSpreadsheet size={20} /> Past sessions</div>
            {sessions.filter((s) => !s.active).length === 0 ? (
              <p className="muted">Ended sessions appear here with an Excel download.</p>
            ) : (
              <ul className="list">
                {sessions.filter((s) => !s.active).map((s) => (
                  <li key={s.id}>
                    <div className="meta">
                      <b>{s.title}</b>
                      <span>{fmtDate(s.startedAt)} · {s.count} present</span>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => download(s)} disabled={busy === "dl" + s.id}>
                      {busy === "dl" + s.id ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Excel
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT: QR + live list */}
        <div className="card">
          {activeId ? (
            <div className="qr-stage">
              <span className="live"><i /> LIVE: students can scan now</span>
              <div style={{ margin: "18px 0 4px" }}>
                {token ? (
                  <div className="qr-box"><QRCodeSVG value={token} size={300} level="M" marginSize={1} /></div>
                ) : (
                  <Loader2 size={40} className="spin" style={{ margin: 60 }} />
                )}
              </div>
              {token && <div className="timer"><i key={token} /></div>}
              <p className="muted">This code refreshes automatically</p>
            </div>
          ) : (
            <div className="empty">
              <QrCode size={54} />
              <p>Start a session to show the QR code</p>
            </div>
          )}

          {activeId && (
            <>
              <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "20px 0 14px" }} />
              <div className="row" style={{ alignItems: "baseline", justifyContent: "space-between" }}>
                <h3>Scanned</h3>
                <div className="stat"><b>{present.length}</b><span className="muted">students</span></div>
              </div>
              {present.length === 0 ? (
                <p className="muted" style={{ marginTop: 8 }}>No one has scanned yet.</p>
              ) : (
                <ul className="list">
                  {present.map((p) => (
                    <li key={p.email}>
                      <div className="avatar">{initials(p.name)}</div>
                      <div className="meta"><b>{p.name}</b><span>{p.email}</span></div>
                      <span className="muted">{fmtTime(p.time)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
