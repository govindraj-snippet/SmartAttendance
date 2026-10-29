import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { ScanLine, CheckCircle2, XCircle, Loader2, Camera } from "lucide-react";
import api, { errMsg } from "./api";

export default function Student() {
  const [status, setStatus] = useState("idle"); // idle | scanning | loading | success | error
  const [msg, setMsg] = useState("");
  const scanner = useRef(null);
  const handled = useRef(false);

  const stopCamera = async () => {
    const s = scanner.current;
    scanner.current = null;
    if (s) {
      try { if (s.isScanning) await s.stop(); s.clear(); } catch { /* already stopped */ }
    }
  };

  const onScan = async (text) => {
    if (handled.current) return;
    handled.current = true;
    await stopCamera();
    setStatus("loading");
    try {
      const { data } = await api.post("/student/attendance", { qrToken: text });
      setMsg(data.message);
      setStatus("success");
    } catch (e) {
      setMsg(errMsg(e, "Could not mark attendance"));
      setStatus("error");
    }
  };

  useEffect(() => {
    if (status !== "scanning") return;
    handled.current = false;
    const s = new Html5Qrcode("reader");
    scanner.current = s;
    s.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 230, height: 230 } }, onScan, () => {})
      .catch(() => {
        setMsg("Camera blocked or unavailable. Allow camera access and make sure the site uses HTTPS.");
        setStatus("error");
      });
  }, [status]);

  useEffect(() => () => { stopCamera(); }, []);

  return (
    <div className="student">
      <div className="page-head">
        <h1>Mark attendance</h1>
        <p className="muted">Scan the QR code shown by your teacher.</p>
      </div>

      <div className="card">
        {status === "scanning" && <div id="reader" className="scanner" />}

        {status === "idle" && (
          <>
            <div className="result-icon idle"><ScanLine size={42} /></div>
            <h2>Ready to scan</h2>
            <p className="muted">Tap the button and point your camera at the QR code on the screen.</p>
            <button className="btn btn-primary btn-block" onClick={() => setStatus("scanning")}>
              <Camera size={18} /> Open camera
            </button>
          </>
        )}

        {status === "scanning" && (
          <>
            <p className="muted" style={{ marginBottom: 14 }}>Hold steady: the QR is detected automatically.</p>
            <button className="btn btn-ghost btn-block" onClick={async () => { await stopCamera(); setStatus("idle"); }}>
              Cancel
            </button>
          </>
        )}

        {status === "loading" && (
          <>
            <div className="result-icon idle"><Loader2 size={42} className="spin" /></div>
            <h2>Marking attendance…</h2>
          </>
        )}

        {status === "success" && (
          <>
            <div className="result-icon ok"><CheckCircle2 size={46} /></div>
            <h2>You're marked present!</h2>
            <p className="muted">{msg}</p>
            <button className="btn btn-ghost btn-block" onClick={() => setStatus("idle")}>Done</button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="result-icon bad"><XCircle size={46} /></div>
            <h2>Couldn't mark attendance</h2>
            <p className="muted">{msg}</p>
            <button className="btn btn-primary btn-block" onClick={() => setStatus("scanning")}>
              <ScanLine size={18} /> Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
