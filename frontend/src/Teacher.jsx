import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Radio,
  StopCircle,
  Loader2,
  QrCode,
  Download,
  BookOpen,
  FileSpreadsheet,
  MapPin,
  Navigation,
  RefreshCw,
} from "lucide-react";
import api, { errMsg } from "./api";

const utc = (t) => new Date(t.endsWith("Z") ? t : t + "Z");
const initials = (n) =>
  n
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const fmtTime = (t) =>
  utc(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtDate = (t) =>
  utc(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export default function Teacher() {
  const [title, setTitle] = useState("");
  const [radius, setRadius] = useState(400);
  const [loc, setLoc] = useState(null);
  const [locStatus, setLocStatus] = useState("idle"); // idle | detecting | ready | denied
  const [locMsg, setLocMsg] = useState("");

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

  const updateRadius = async (newRadius) => {
    if (!activeId) return;
    try {
      await api.patch(`/teacher/sessions/${activeId}`, { radius: newRadius });
      setSessions((prev) =>
        prev.map((s) => (s.id === activeId ? { ...s, radius: newRadius } : s))
      );
      setMsg({ type: "ok", text: `Classroom range updated to ${newRadius}m!` });
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

  // Detect location for geofencing
  const detectLocation = () => {
    if (!navigator.geolocation) {
      setLocStatus("denied");
      setLocMsg("Geolocation is not supported by your browser");
      return Promise.reject(new Error("Geolocation unsupported"));
    }
    setLocStatus("detecting");
    setLocMsg("Detecting your classroom location...");
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy || 0),
          };
          setLoc(coords);
          setLocStatus("ready");
          setLocMsg(`Location locked (±${coords.accuracy}m accuracy)`);
          resolve(coords);
        },
        (err) => {
          let errText = "Could not get your location. Please turn on location services.";
          if (err.code === 1) {
            errText =
              "Location permission denied. Please allow location access in your browser so students can be verified within your classroom.";
          } else if (err.code === 2) {
            errText = "Location unavailable. Please make sure device GPS / Location is turned on.";
          } else if (err.code === 3) {
            errText = "Location request timed out. Please try again.";
          }
          setLocStatus("denied");
          setLocMsg(errText);
          reject(new Error(errText));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  };

  // Refresh QR every 10s and the present list every 4s
  useEffect(() => {
    if (!activeId) return;
    let alive = true;

    const loadQr = async () => {
      try {
        const { data } = await api.get(`/teacher/sessions/${activeId}/qr`);
        if (alive) setToken(data.token);
      } catch (e) {
        if ([404, 410].includes(e.response?.status) && alive) {
          setActiveId(null);
          setToken("");
          refresh();
        }
      }
    };
    const loadPresent = async () => {
      try {
        const { data } = await api.get(`/teacher/sessions/${activeId}/attendance`);
        if (alive) setPresent(data);
      } catch {
        /* next tick retries */
      }
    };

    loadQr();
    loadPresent();
    const a = setInterval(loadQr, 10000);
    const b = setInterval(loadPresent, 4000);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, [activeId]);

  const run = async (name, fn) => {
    setBusy(name);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ type: "error", text: errMsg(e) });
    }
    setBusy("");
  };

  const start = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    let currentLoc = loc;
    if (!currentLoc) {
      try {
        currentLoc = await detectLocation();
      } catch (err) {
        setMsg({
          type: "error",
          text:
            err.message ||
            "Please turn on location and allow browser permission to set up attendance for this classroom.",
        });
        return;
      }
    }

    run("start", async () => {
      const { data } = await api.post("/teacher/sessions", {
        title: title.trim(),
        lat: currentLoc.lat,
        lng: currentLoc.lng,
        accuracy: currentLoc.accuracy || 0,
        radius: Number(radius) || 200,
      });
      setPresent([]);
      setToken("");
      setTitle("");
      await refresh();
      setActiveId(data.sessionId);
    });
  };

  const end = () =>
    run("end", async () => {
      await api.post(`/teacher/sessions/${activeId}/end`);
      setActiveId(null);
      setToken("");
      await refresh();
      setMsg({
        type: "ok",
        text: "Session ended. You can download the attendance sheet below.",
      });
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
        <p className="muted">
          Start a location-verified session, show the QR, and record verified student scans.
        </p>
      </div>

      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <div className="grid-2">
        {/* LEFT: control + history */}
        <div>
          <div className="card">
            <div className="card-title">
              <BookOpen size={20} />{" "}
              {active ? "Session in progress" : "New attendance session"}
            </div>
            {active ? (
              <>
                <b>{active.title}</b>
                <div>
                  <span className="location-pill">
                    <MapPin size={13} /> Base range: ±{active.radius || 200}m
                    {active.lat && active.lat !== 0
                      ? ` (${active.lat.toFixed(4)}°, ${active.lng.toFixed(4)}°)`
                      : ""}
                  </span>
                </div>

                {/* Range expander on the fly */}
                <div style={{ margin: "4px 0 14px", padding: "10px 12px", background: "var(--bg)", borderRadius: 12, border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Adjust range if students are nearby:</span>
                    <span className="badge">{active.radius}m</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[200, 400, 600, 1000].map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`radius-btn ${active.radius === r ? "on" : ""}`}
                        style={{ flex: 1, padding: "5px 2px", fontSize: 11 }}
                        onClick={() => updateRadius(r)}
                      >
                        {r >= 1000 ? `${r / 1000}km` : `${r}m`}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="muted" style={{ margin: "4px 0 16px" }}>
                  Started {fmtDate(active.startedAt)}
                </p>
                <div className="row">
                  <button
                    className="btn btn-danger"
                    style={{ flex: 1 }}
                    onClick={end}
                    disabled={busy === "end"}
                  >
                    <StopCircle size={17} /> End session
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => download(active)}
                    disabled={busy === "dl" + active.id}
                  >
                    <Download size={16} /> Download
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={start}>
                <div className="field">
                  <BookOpen size={17} />
                  <input
                    className="input"
                    placeholder="e.g. Java - Section A, Lecture 5"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>

                {/* Location status box */}
                {locStatus === "ready" && loc ? (
                  <div className="geo-box">
                    <div className="geo-info">
                      <div className="geo-icon ready">
                        <MapPin size={18} />
                      </div>
                      <div className="geo-text">
                        <b>Classroom Location Locked</b>
                        <span>
                          {loc.lat.toFixed(4)}°, {loc.lng.toFixed(4)}° (±{loc.accuracy}m accuracy)
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={detectLocation}
                      title="Update location"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                ) : locStatus === "detecting" ? (
                  <div className="geo-box">
                    <div className="geo-info">
                      <div className="geo-icon">
                        <Loader2 size={18} className="spin" />
                      </div>
                      <div className="geo-text">
                        <b>Acquiring GPS Coordinates...</b>
                        <span>Please allow browser location prompt</span>
                      </div>
                    </div>
                  </div>
                ) : locStatus === "denied" ? (
                  <div className="geo-box">
                    <div className="geo-info">
                      <div className="geo-icon warn">
                        <MapPin size={18} />
                      </div>
                      <div className="geo-text">
                        <b>Location access required</b>
                        <span>{locMsg}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={detectLocation}
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="geo-box">
                    <div className="geo-info">
                      <div className="geo-icon">
                        <Navigation size={18} />
                      </div>
                      <div className="geo-text">
                        <b>Classroom Geofencing</b>
                        <span>Your location will be locked when session starts</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={detectLocation}
                    >
                      Detect now
                    </button>
                  </div>
                )}

                {/* Radius selection */}
                <div className="radius-select-wrap">
                  <label className="radius-label">
                    Allowed student distance from teacher:
                  </label>
                  <div className="radius-select">
                    {[
                      { r: 100, label: "100m", desc: "Room" },
                      { r: 200, label: "200m", desc: "Class" },
                      { r: 400, label: "400m", desc: "Wi-Fi" },
                      { r: 800, label: "800m", desc: "Hall" },
                    ].map((opt) => (
                      <button
                        key={opt.r}
                        type="button"
                        className={`radius-btn ${radius === opt.r ? "on" : ""}`}
                        onClick={() => setRadius(opt.r)}
                      >
                        {opt.label} ({opt.desc})
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  className="btn btn-primary btn-block"
                  disabled={busy === "start" || locStatus === "detecting"}
                >
                  {busy === "start" || locStatus === "detecting" ? (
                    <Loader2 size={17} className="spin" />
                  ) : (
                    <Radio size={17} />
                  )}{" "}
                  Start attendance
                </button>
              </form>
            )}
          </div>

          <div className="card">
            <div className="card-title">
              <FileSpreadsheet size={20} /> Past sessions
            </div>
            {sessions.filter((s) => !s.active).length === 0 ? (
              <p className="muted">Ended sessions appear here with an Excel download.</p>
            ) : (
              <ul className="list">
                {sessions
                  .filter((s) => !s.active)
                  .map((s) => (
                    <li key={s.id}>
                      <div className="meta">
                        <b>{s.title}</b>
                        <span>
                          {fmtDate(s.startedAt)} · {s.count} present · range: {s.radius || 100}m
                        </span>
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => download(s)}
                        disabled={busy === "dl" + s.id}
                      >
                        {busy === "dl" + s.id ? (
                          <Loader2 size={15} className="spin" />
                        ) : (
                          <Download size={15} />
                        )}{" "}
                        Excel
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
              <span className="live">
                <i /> LIVE: students can scan now
              </span>
              <div style={{ margin: "18px 0 4px" }}>
                {token ? (
                  <div className="qr-box">
                    <QRCodeSVG value={token} size={300} level="M" marginSize={1} />
                  </div>
                ) : (
                  <Loader2 size={40} className="spin" style={{ margin: 60 }} />
                )}
              </div>
              {token && (
                <div className="timer">
                  <i key={token} />
                </div>
              )}
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
              <hr
                style={{
                  border: 0,
                  borderTop: "1px solid var(--border)",
                  margin: "20px 0 14px",
                }}
              />
              <div
                className="row"
                style={{ alignItems: "baseline", justifyContent: "space-between" }}
              >
                <h3>Scanned</h3>
                <div className="stat">
                  <b>{present.length}</b>
                  <span className="muted">students</span>
                </div>
              </div>
              {present.length === 0 ? (
                <p className="muted" style={{ marginTop: 8 }}>
                  No one has scanned yet.
                </p>
              ) : (
                <ul className="list">
                  {present.map((p) => (
                    <li key={p.email}>
                      <div className="avatar">{initials(p.name)}</div>
                      <div className="meta">
                        <b>{p.name}</b>
                        <span>{p.email}</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span className="muted" style={{ display: "block" }}>
                          {fmtTime(p.time)}
                        </span>
                        {p.distance !== undefined && p.distance !== null && (
                          <span className="distance-badge">
                            <MapPin size={11} /> {Math.round(p.distance)}m away
                          </span>
                        )}
                      </div>
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
