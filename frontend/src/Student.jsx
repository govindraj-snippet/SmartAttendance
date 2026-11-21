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
  BookOpen,
  UsersRound,
  RefreshCw,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import api, { errMsg } from "./api";
import { ACADEMIC_YEARS, BRANCHES } from "./academic";

export default function Student() {
  const location = useLocation();
  const showCourses = location.pathname.endsWith("/courses");
  const [studentProfile, setStudentProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [profileForm, setProfileForm] = useState({ year: "", branch: "" });
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [courses, setCourses] = useState([]);
  const [courseLoading, setCourseLoading] = useState(false);
  const [enrollingCourseId, setEnrollingCourseId] = useState(null);
  const [rollNumbers, setRollNumbers] = useState({});
  const [courseMessage, setCourseMessage] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | scanning | loading | success | error
  const [msg, setMsg] = useState("");
  const [distance, setDistance] = useState(null);
  const scanner = useRef(null);
  const handled = useRef(false);
  const courseRequestId = useRef(0);

  const loadCourses = async (year, branch) => {
    const requestId = ++courseRequestId.current;
    if (!year || !branch) return;
    try {
      const { data } = await api.get("/student/courses", {
        params: { year: Number(year), branch },
      });
      if (requestId === courseRequestId.current) setCourses(data);
    } catch (error) {
      if (requestId === courseRequestId.current) {
        setCourseMessage({ type: "error", text: errMsg(error, "Could not load courses") });
      }
    } finally {
      if (requestId === courseRequestId.current) setCourseLoading(false);
    }
  };

  const enroll = async (courseId) => {
    const rollNumber = (rollNumbers[courseId] || "").trim();
    if (!rollNumber) {
      setCourseMessage({ type: "error", text: "Enter your roll number to enroll." });
      return;
    }
    setEnrollingCourseId(courseId);
    setCourseMessage(null);
    try {
      await api.post(`/student/courses/${courseId}/enrollments`, { rollNumber });
      setCourseMessage({ type: "ok", text: "Enrollment successful. You can now mark attendance for this course." });
      setCourseLoading(true);
      await loadCourses(selectedYear, selectedBranch);
    } catch (error) {
      setCourseMessage({ type: "error", text: errMsg(error, "Could not enroll in this course") });
    } finally {
      setEnrollingCourseId(null);
    }
  };

  const saveStudentProfile = async (event) => {
    event.preventDefault();
    try {
      const { data } = await api.put("/student/profile", profileForm);
      setStudentProfile(data);
      setSelectedYear(String(data.year));
      setSelectedBranch(data.branch);
      setCourseLoading(true);
      setCourseMessage(null);
    } catch (error) {
      setCourseMessage({ type: "error", text: errMsg(error, "Could not save your student profile") });
    }
  };

  const loadStudentProfile = async () => {
    setProfileLoading(true);
    setProfileError("");
    try {
      const { data } = await api.get("/student/profile");
      setStudentProfile(data);
      if (data.profileComplete) {
        setSelectedYear(String(data.year));
        setSelectedBranch(data.branch);
        setCourseLoading(true);
      }
    } catch (error) {
      setProfileError(errMsg(error, "Could not load student profile"));
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    loadStudentProfile();
  }, []);

  useEffect(() => {
    if (!selectedYear || !selectedBranch || !studentProfile?.profileComplete) return undefined;
    const requestId = ++courseRequestId.current;
    let alive = true;
    api.get("/student/courses", {
      params: { year: Number(selectedYear), branch: selectedBranch },
    })
      .then(({ data }) => {
        if (alive && requestId === courseRequestId.current) setCourses(data);
      })
      .catch((error) => {
        if (alive && requestId === courseRequestId.current) {
          setCourseMessage({ type: "error", text: errMsg(error, "Could not load courses") });
        }
      })
      .finally(() => {
        if (alive && requestId === courseRequestId.current) setCourseLoading(false);
      });
    return () => {
      alive = false;
      if (requestId === courseRequestId.current) courseRequestId.current += 1;
    };
  }, [selectedYear, selectedBranch, studentProfile?.profileComplete]);

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
        <h1>{showCourses ? "Courses" : "Mark attendance"}</h1>
        <p className="muted">
          {showCourses
            ? "Find courses for your year and branch, and manage your enrollments."
            : "Scan your instructor's classroom QR code to record your attendance."}
        </p>
      </div>

      {showCourses && <section className="card student-courses">
        <div className="card-title">
          <BookOpen size={20} /> Find your courses
        </div>
        {courseMessage && (
          <div className={`alert ${courseMessage.type}`}>{courseMessage.text}</div>
        )}
        {profileLoading ? (
          <p className="muted course-loading"><Loader2 size={16} className="spin" /> Loading student profile…</p>
        ) : profileError ? (
          <div className="profile-error">
            <p className="muted">{profileError}</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={loadStudentProfile}>
              Retry
            </button>
          </div>
        ) : !studentProfile?.profileComplete ? (
          <form className="student-profile-form" onSubmit={saveStudentProfile}>
            <p className="muted">
              Add your academic year and branch to find the courses available to you.
            </p>
            <label>
              <span>Academic year</span>
              <select
                className="input"
                value={profileForm.year}
                onChange={(event) => setProfileForm({ ...profileForm, year: event.target.value })}
                required
              >
                <option value="">Select your year</option>
                {ACADEMIC_YEARS.map((year) => (
                  <option key={year} value={year}>Year {year}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Branch</span>
              <select
                className="input course-input"
                value={profileForm.branch}
                onChange={(event) => setProfileForm({ ...profileForm, branch: event.target.value })}
                required
              >
                <option value="">Select your branch</option>
                {BRANCHES.map((branch) => (
                  <option key={branch} value={branch}>{branch}</option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary" type="submit">
              <BookOpen size={16} /> Save and find courses
            </button>
          </form>
        ) : (
          <>
            <div className="student-profile-summary">
              <span className="badge">Year {studentProfile.year}</span>
              <span className="badge">{studentProfile.branch}</span>
              <span className="muted">Courses matching your registered profile</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={courseLoading}
                onClick={() => {
                  setCourseLoading(true);
                  loadCourses(selectedYear, selectedBranch);
                }}
              >
                {courseLoading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                Refresh courses
              </button>
            </div>

            {courseLoading ? (
              <p className="muted course-loading"><Loader2 size={16} className="spin" /> Loading courses…</p>
            ) : courses.length ? (
              <ul className="student-course-list">
                {courses.map((course) => (
                  <li key={course.id} className="student-course-item">
                    <div className="student-course-info">
                      <div className="student-course-heading">
                        <div>
                          <b>{course.name}</b>
                          <span>{course.subject} · Year {course.year} · {course.branch}
                            {course.section ? ` · Section ${course.section}` : ""}
                            {course.term ? ` · ${course.term}` : ""}
                          </span>
                        </div>
                        <span className="badge"><UsersRound size={13} /> {course.enrollmentCount} enrolled</span>
                      </div>
                      <p className="muted">Teacher: {course.teacherName}</p>
                    </div>
                    {course.isEnrolled ? (
                      <span className="enrolled-pill">Enrolled · Roll {course.rollNumber}</span>
                    ) : (
                      <form
                        className="student-enroll-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          enroll(course.id);
                        }}
                      >
                        <input
                          className="input course-input"
                          aria-label={`Roll number for ${course.name}`}
                          placeholder="Your roll number"
                          value={rollNumbers[course.id] || ""}
                          onChange={(event) => setRollNumbers({
                            ...rollNumbers,
                            [course.id]: event.target.value,
                          })}
                          maxLength={80}
                          required
                        />
                        <button
                          className="btn btn-primary"
                          disabled={enrollingCourseId === course.id}
                        >
                          {enrollingCourseId === course.id
                            ? <Loader2 size={16} className="spin" />
                            : <BookOpen size={16} />}
                          Enroll
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty course-empty">No courses are available for this year and branch yet.</p>
            )}
          </>
        )}
      </section>}

      {!showCourses && (
      <section className="card student-scan">
        <div className="card-title"><ScanLine size={20} /> Mark attendance</div>
        {!profileLoading && !profileError && !studentProfile?.profileComplete && (
          <div className="alert error">
            Complete your student profile in <Link to="/student/courses">Courses</Link> before marking attendance.
          </div>
        )}
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
      </section>
      )}
    </div>
  );
}
