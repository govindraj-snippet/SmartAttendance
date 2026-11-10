import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  ScanLine,
  CheckCircle2,
  XCircle,
  Loader2,
  Camera,
  MapPin,
  Navigation,
} from "lucide-react";
import api, { errMsg } from "./api";

export default function Student() {
  const [status, setStatus] = useState("idle"); // idle | scanning | loading | success | error
  const [msg, setMsg] = useState("");
  const [distance, setDistance] = useState(null);
  const scanner = useRef(null);
  const handled = useRef(false);

  const stopCamera = async () => {
    const s = scanner.current;
    scanner.current = null;
    if (s) {
      try {
        if (s.isScanning) await s.stop();
        s.clear();
      } catch {
        /* already stopped */
      }
    }
  };

  const getStudentLocation = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Your browser or device does not support geolocation."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy || 0),
          });
        },
        (err) => {
          let errText = "Could not get your location. Please turn on location services.";
          if (err.code === 1) {
            errText =
              "Location permission denied. Please allow location access in your browser to verify you are inside the classroom.";
          } else if (err.code === 2) {
            errText =
              "Location unavailable. Please make sure your phone's GPS / Location is turned ON.";
          } else if (err.code === 3) {
            errText = "Location request timed out. Please check your GPS signal and try again.";
          }
          reject(new Error(errText));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  };

  const onScan = async (text) => {
    if (handled.current) return;
    handled.current = true;
    await stopCamera();
    setStatus("loading");
    setMsg("Acquiring GPS location and verifying with classroom...");
    setDistance(null);

    let loc;
    try {
      loc = await getStudentLocation();
    } catch (e) {
      setMsg(e.message || "Location access is required to mark attendance.");
      setStatus("error");
      return;
    }

    try {
      const { data } = await api.post("/student/attendance", {
        qrToken: text,
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
      });
      setMsg(data.message);
      if (data.distance !== undefined && data.distance !== null) {
        setDistance(data.distance);
      }
      setStatus("success");
    } catch (e) {
      setMsg(errMsg(e, "Could not mark attendance"));
      setStatus("error");
    }
  };

  const startScanning = () => {
    // Proactively request / warm-up GPS location so browser asks for permission early
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => {},
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
    setStatus("scanning");
  };

  useEffect(() => {
    if (status !== "scanning") return;
    handled.current = false;
    const s = new Html5Qrcode("reader");
    scanner.current = s;
    s.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 230, height: 230 } },
      onScan,
      () => {}
    ).catch(() => {
      setMsg("Camera blocked or unavailable. Allow camera access and make sure the site uses HTTPS.");
      setStatus("error");
    });
  }, [status]);

  useEffect(() => () => {
    stopCamera();
  }, []);

  return (
    <div className="student">
      <div className="page-head">
        <h1>Mark attendance</h1>
        <p className="muted">Scan the QR code shown by your teacher to verify your attendance.</p>
      </div>

      <div className="card">
        {status === "scanning" && <div id="reader" className="scanner" />}

        {status === "idle" && (
          <>
            <div className="student-geo-notice">
              <MapPin size={15} /> In-class verification: GPS must be turned ON
            </div>
            <div className="result-icon idle">
              <ScanLine size={42} />
            </div>
            <h2>Ready to scan</h2>
            <p className="muted">
              Tap the button and point your camera at the QR code displayed on the screen.
            </p>
            <button className="btn btn-primary btn-block" onClick={startScanning}>
              <Camera size={18} /> Open camera & scan
            </button>
          </>
        )}

        {status === "scanning" && (
          <>
            <p className="muted" style={{ marginBottom: 14 }}>
              Hold steady: camera detects QR code and your GPS location is checked automatically.
            </p>
            <button
              className="btn btn-ghost btn-block"
              onClick={async () => {
                await stopCamera();
                setStatus("idle");
              }}
            >
              Cancel
            </button>
          </>
        )}

        {status === "loading" && (
          <>
            <div className="result-icon idle">
              <Loader2 size={42} className="spin" />
            </div>
            <h2>Verifying attendance…</h2>
            <p className="muted">{msg}</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="result-icon ok">
              <CheckCircle2 size={46} />
            </div>
            <h2>You're marked present!</h2>
            <p className="muted" style={{ marginBottom: distance !== null ? 6 : 20 }}>
              {msg}
            </p>
            {distance !== null && (
              <div style={{ marginBottom: 20 }}>
                <span className="distance-badge">
                  <Navigation size={12} /> Verified distance: {Math.round(distance)}m from teacher
                </span>
              </div>
            )}
            <button className="btn btn-ghost btn-block" onClick={() => setStatus("idle")}>
              Done
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="result-icon bad">
              <XCircle size={46} />
            </div>
            <h2>Couldn't mark attendance</h2>
            <p className="muted">{msg}</p>
            <button className="btn btn-primary btn-block" onClick={startScanning}>
              <ScanLine size={18} /> Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
