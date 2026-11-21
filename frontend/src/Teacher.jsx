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
  UsersRound,
  UserPlus,
  Pencil,
  X,
  ClipboardList,
  CalendarCheck,
  ChevronDown,
  BarChart3,
  Search,
} from "lucide-react";
import api, { errMsg } from "./api";
import { ACADEMIC_YEARS, BRANCHES } from "./academic";

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
  const [activeSection, setActiveSection] = useState("courses");
  const [performance, setPerformance] = useState([]);
  const [performanceSearch, setPerformanceSearch] = useState("");
  const [performanceCourseId, setPerformanceCourseId] = useState("");
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceError, setPerformanceError] = useState("");
  const [performanceRefresh, setPerformanceRefresh] = useState(0);
  const [title, setTitle] = useState("");
  const [radius, setRadius] = useState(400);
  const [courses, setCourses] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [courseForm, setCourseForm] = useState({
    name: "",
    subject: "",
    year: "",
    section: "",
    term: "",
  });
  const [studentForm, setStudentForm] = useState({ studentEmail: "", rollNumber: "" });
  const [courseBusy, setCourseBusy] = useState("");
  const [courseReport, setCourseReport] = useState(null);
  const [editingCourseId, setEditingCourseId] = useState(null);
  const [teacherProfile, setTeacherProfile] = useState(null);
  const [teacherBranch, setTeacherBranch] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
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
  const selectedCourse = courses.find((course) => course.id === Number(selectedCourseId));

  const refresh = async () => {
    try {
      const { data } = await api.get("/teacher/sessions");
      setSessions(data);
      return data;
    } catch (e) {
      setMsg({ type: "error", text: errMsg(e) });
    }
  };

  const refreshCourses = async (preferredId) => {
    try {
      const { data } = await api.get("/teacher/courses");
      setCourses(data);
      setSelectedCourseId((current) => {
        const nextId = preferredId || (current && data.some((course) => course.id === Number(current))
          ? Number(current)
          : data[0]?.id);
        return nextId ? String(nextId) : "";
      });
      return data;
    } catch (e) {
      setMsg({ type: "error", text: errMsg(e) });
      return [];
    }
  };

  const loadTeacherProfile = async () => {
    try {
      const { data } = await api.get("/teacher/profile");
      setTeacherProfile(data);
      setTeacherBranch(data.branch || "");
    } catch (e) {
      setMsg({ type: "error", text: errMsg(e) });
    }
  };

  const saveTeacherProfile = async (e) => {
    e.preventDefault();
    setProfileSaving(true);
    setMsg(null);
    try {
      const { data } = await api.put("/teacher/profile", { branch: teacherBranch });
      setTeacherProfile(data);
      setTeacherBranch(data.branch);
      await refreshCourses();
      setMsg({ type: "ok", text: `Teacher branch set to ${data.branch}.` });
    } catch (error) {
      setMsg({ type: "error", text: errMsg(error) });
    } finally {
      setProfileSaving(false);
    }
  };

  const refreshCourseReport = async (courseId = selectedCourseId) => {
    if (!courseId) {
      setCourseReport(null);
      return;
    }
    try {
      const { data } = await api.get(`/teacher/courses/${courseId}`);
      setCourseReport(data);
      setCourses((current) => current.map((course) => (
        course.id === Number(courseId)
          ? { ...course, enrollmentCount: data.enrollments.length }
          : course
      )));
    } catch (e) {
      setMsg({ type: "error", text: errMsg(e) });
    }
  };

  const createCourse = async (e) => {
    e.preventDefault();
    setCourseBusy("create");
    setMsg(null);
    try {
      const { data } = editingCourseId
        ? await api.patch(`/teacher/courses/${editingCourseId}`, courseForm)
        : await api.post("/teacher/courses", courseForm);
      setCourseForm({ name: "", subject: "", year: "", section: "", term: "" });
      setEditingCourseId(null);
      await refreshCourses(data.id);
      await refreshCourseReport(data.id);
      setMsg({ type: "ok", text: editingCourseId ? "Course details updated." : "Course created." });
    } catch (error) {
      setMsg({ type: "error", text: errMsg(error) });
    } finally {
      setCourseBusy("");
    }
  };

  const editCourse = (course) => {
    setEditingCourseId(course.id);
    setCourseForm({
      name: course.name,
      subject: course.subject,
      year: course.year ? String(course.year) : "",
      section: course.section || "",
      term: course.term || "",
    });
  };

  const detectLocationFromButton = () => {
    detectLocation().catch(() => {
      // The location status panel displays the error to the user.
    });
  };

  const cancelCourseEdit = () => {
    setEditingCourseId(null);
    setCourseForm({ name: "", subject: "", year: "", section: "", term: "" });
  };

  const enrollStudent = async (e) => {
    e.preventDefault();
    if (!selectedCourseId) return;
    setCourseBusy("enroll");
    setMsg(null);
    try {
      await api.post(`/teacher/courses/${selectedCourseId}/enrollments`, studentForm);
      setStudentForm({ studentEmail: "", rollNumber: "" });
      await refreshCourses(Number(selectedCourseId));
      await refreshCourseReport(selectedCourseId);
      setMsg({ type: "ok", text: "Student enrolled in this course." });
    } catch (error) {
      setMsg({ type: "error", text: errMsg(error) });
    } finally {
      setCourseBusy("");
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
    refreshCourses();
    loadTeacherProfile();
  }, []);

  useEffect(() => {
    refreshCourseReport();
    if (!selectedCourseId) return undefined;
    const timer = setInterval(() => refreshCourseReport(selectedCourseId), 5000);
    return () => clearInterval(timer);
  }, [selectedCourseId]);

  useEffect(() => {
    if (activeSection !== "performance") return undefined;
    let alive = true;
    const loadPerformance = async () => {
      setPerformanceLoading(true);
      setPerformanceError("");
      try {
        const { data } = await api.get("/teacher/attendance-performance");
        if (alive) setPerformance(data);
      } catch (error) {
        if (alive) setPerformanceError(errMsg(error));
      } finally {
        if (alive) setPerformanceLoading(false);
      }
    };

    loadPerformance();
    const timer = setInterval(loadPerformance, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeSection, performanceRefresh]);

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
        if (alive) {
          setPresent(data);
        }
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
    if (!title.trim() || !selectedCourseId) return;

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
        courseId: Number(selectedCourseId),
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

  const allPerformanceRows = performance.flatMap((course) =>
    (course.students || []).map((student) => ({ course, student }))
  );
  const normalizedSearch = performanceSearch.trim().toLowerCase();
  const filteredPerformanceCourses = performance
    .filter((course) => !performanceCourseId || course.id === Number(performanceCourseId))
    .map((course) => ({
      ...course,
      visibleStudents: course.students.filter((student) =>
        [
          student.name,
          student.email,
          student.rollNumber,
          course.name,
          course.subject,
          course.branch,
          course.section,
        ].some((value) => String(value || "").toLowerCase().includes(normalizedSearch))
      ),
    }))
    .filter((course) => course.visibleStudents.length > 0);
  const filteredPerformanceRows = filteredPerformanceCourses.flatMap((course) =>
    course.visibleStudents.map((student) => ({ course, student }))
  );
  const performanceTotals = filteredPerformanceRows.reduce((totals, { student }) => ({
    present: totals.present + student.present,
    sessions: totals.sessions + student.sessions,
  }), { present: 0, sessions: 0 });
  const overallAttendance = performanceTotals.sessions
    ? Math.round(performanceTotals.present * 100 / performanceTotals.sessions)
    : 0;

  return (
    <>
      <div className="page-head">
        <h1>Teacher dashboard</h1>
        <p className="muted">
          Start a location-verified session, show the QR, and record verified student scans.
        </p>
      </div>

      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <nav className="teacher-sections" aria-label="Teacher dashboard sections">
        <button
          type="button"
          className={`teacher-section-tab ${activeSection === "courses" ? "on" : ""}`}
          onClick={() => setActiveSection("courses")}
          aria-current={activeSection === "courses" ? "page" : undefined}
        >
          <ClipboardList size={17} />
          <span>Courses &amp; Students</span>
          <span className="teacher-tab-count">{courses.length}</span>
        </button>
        <button
          type="button"
          className={`teacher-section-tab ${activeSection === "attendance" ? "on" : ""}`}
          onClick={() => setActiveSection("attendance")}
          aria-current={activeSection === "attendance" ? "page" : undefined}
        >
          <QrCode size={17} />
          <span>Attendance &amp; QR</span>
          {active && <span className="teacher-tab-live"><i /> Live</span>}
        </button>
        <button
          type="button"
          className={`teacher-section-tab ${activeSection === "performance" ? "on" : ""}`}
          onClick={() => setActiveSection("performance")}
          aria-current={activeSection === "performance" ? "page" : undefined}
        >
          <BarChart3 size={17} />
          <span>Attendance Performance</span>
          <span className="teacher-tab-count">{allPerformanceRows.length}</span>
        </button>
      </nav>

      {activeSection === "performance" && (
        <section className="card performance-section">
          <div className="performance-heading">
            <div>
              <div className="card-title"><BarChart3 size={20} /> Student performance by course</div>
              <p className="muted">
                Attendance percentage and session-by-session records for every enrolled student.
                Data refreshes automatically every 30 seconds.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setPerformanceRefresh((value) => value + 1)}
              disabled={performanceLoading}
            >
              {performanceLoading
                ? <Loader2 size={16} className="spin" />
                : <RefreshCw size={16} />}
              Refresh
            </button>
          </div>

          <div className="performance-summary">
            <div><b>{filteredPerformanceCourses.length}</b><span>Courses in this view</span></div>
            <div><b>{filteredPerformanceRows.length}</b><span>Student-course records</span></div>
            <div>
              <b>{performanceTotals.sessions ? `${overallAttendance}%` : "—"}</b>
              <span>Overall attendance across completed sessions</span>
            </div>
          </div>

          <div className="performance-filters">
            <label className="performance-search">
              <Search size={17} />
              <input
                className="input"
                type="search"
                placeholder="Search students, email, roll number, course, or subject"
                value={performanceSearch}
                onChange={(event) => setPerformanceSearch(event.target.value)}
              />
            </label>
            <select
              className="input performance-course-filter"
              value={performanceCourseId}
              onChange={(event) => setPerformanceCourseId(event.target.value)}
              aria-label="Filter performance by course"
            >
              <option value="">All courses</option>
              {performance.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name} · {course.subject}
                </option>
              ))}
            </select>
          </div>

          {performanceError && <div className="alert error">{performanceError}</div>}
          {performanceLoading && !performance.length ? (
            <div className="performance-empty"><Loader2 size={22} className="spin" /> Loading attendance performance...</div>
          ) : !allPerformanceRows.length ? (
            <div className="performance-empty">
              No enrolled student records yet. Enroll students in a course to see their attendance performance here.
            </div>
          ) : !filteredPerformanceRows.length ? (
            <div className="performance-empty">No student or course matches that search.</div>
          ) : (
            <div className="performance-course-list">
              {filteredPerformanceCourses.map((course) => {
                const coursePresent = course.visibleStudents.reduce(
                  (sum, student) => sum + student.present, 0
                );
                const courseSessions = course.visibleStudents.reduce(
                  (sum, student) => sum + student.sessions, 0
                );
                const courseAverage = courseSessions
                  ? Math.round(coursePresent * 100 / courseSessions)
                  : null;
                return (
                  <section className="performance-course-card" key={course.id}>
                    <header className="performance-course-heading">
                      <div>
                        <h3>{course.name}</h3>
                        <p>{course.subject}
                          {course.year ? ` · Year ${course.year}` : ""}
                          {course.branch ? ` · ${course.branch}` : ""}
                          {course.section ? ` · Section ${course.section}` : ""}
                          {course.term ? ` · ${course.term}` : ""}
                        </p>
                      </div>
                      <div className="performance-course-stats">
                        <span><b>{course.visibleStudents.length}</b> students</span>
                        <span><b>{course.sessionsHeld}</b> completed sessions</span>
                        <span><b>{courseAverage === null ? "—" : `${courseAverage}%`}</b> average attendance</span>
                      </div>
                    </header>

                    <div className="performance-table-wrap">
                      <table className="performance-table">
                        <thead>
                          <tr>
                            <th>Student / enrollment</th>
                            <th>Attendance count</th>
                            <th>Attendance rate</th>
                            <th>Session-by-session record</th>
                          </tr>
                        </thead>
                        <tbody>
                          {course.visibleStudents.map((student) => (
                            <tr key={`${course.id}-${student.studentId}`}>
                              <td>
                                <b>{student.name}</b>
                                <span>Roll {student.rollNumber} · {student.email}</span>
                                <span>Enrolled {utc(student.enrolledAt).toLocaleDateString()}</span>
                              </td>
                              <td>
                                <b>{student.present} present / {student.sessions} held</b>
                                <span>{student.absent} absent</span>
                              </td>
                              <td>
                                {student.sessions > 0 ? (
                                  <div className="performance-percent">
                                    <b>{student.percentage}%</b>
                                    <div className="performance-track" aria-label={`${student.percentage}% attendance`}>
                                      <i style={{ width: `${student.percentage}%` }} />
                                    </div>
                                  </div>
                                ) : <b className="muted">Not evaluated</b>}
                              </td>
                              <td>
                                <details className="student-attendance-details">
                                  <summary aria-label={`View ${student.name}'s attendance records for ${course.subject}`}>
                                    <ChevronDown size={16} />
                                    <span>{student.sessions} session records</span>
                                  </summary>
                                  <ul>
                                    {!student.records?.length && (
                                      <li className="muted">No completed sessions since enrollment.</li>
                                    )}
                                    {student.records?.map((record) => (
                                      <li key={record.sessionId}>
                                        <span>
                                          <b>{record.title}</b>
                                          <small>{fmtDate(record.startedAt)}</small>
                                        </span>
                                        <b className={record.present ? "record-present" : "record-absent"}>
                                          {record.present ? "Present" : "Absent"}
                                          {record.markedAt ? ` · Marked ${fmtTime(record.markedAt)}` : ""}
                                        </b>
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </section>
      )}

      {activeSection === "courses" && <section className="card course-manager">
        <div className="card-title">
          <UsersRound size={20} /> Courses and student enrollment
        </div>
        <form className="teacher-profile-form" onSubmit={saveTeacherProfile}>
          <label>
            <span>Your branch (courses will be listed under this branch)</span>
            <select
              className="input course-input"
              value={teacherBranch}
              onChange={(e) => setTeacherBranch(e.target.value)}
              required
            >
              <option value="">Select your branch</option>
              {BRANCHES.map((branch) => (
                <option key={branch} value={branch}>{branch}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-ghost" disabled={profileSaving || !teacherBranch}>
            {profileSaving ? <Loader2 size={16} className="spin" /> : <UsersRound size={16} />}
            Save branch
          </button>
        </form>
        <form onSubmit={createCourse}>
          <div className="course-fields">
            <input
              className="input course-input"
              placeholder="Class name (e.g. Computer Science)"
              value={courseForm.name}
              onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })}
              maxLength={120}
              required
            />
            <input
              className="input course-input"
              placeholder="Subject (e.g. Programming)"
              value={courseForm.subject}
              onChange={(e) => setCourseForm({ ...courseForm, subject: e.target.value })}
              maxLength={120}
              required
            />
            <select
              className="input course-input"
              value={courseForm.year}
              onChange={(e) => setCourseForm({ ...courseForm, year: e.target.value })}
              required
              aria-label="Academic year"
            >
              <option value="">Select academic year</option>
              {ACADEMIC_YEARS.map((year) => (
                <option key={year} value={year}>{`Year ${year}`}</option>
              ))}
            </select>
            <input
              className="input course-input"
              placeholder="Section (optional)"
              value={courseForm.section}
              onChange={(e) => setCourseForm({ ...courseForm, section: e.target.value })}
              maxLength={80}
            />
            <input
              className="input course-input"
              placeholder="Semester / batch (optional)"
              value={courseForm.term}
              onChange={(e) => setCourseForm({ ...courseForm, term: e.target.value })}
              maxLength={80}
            />
            <button
              className="btn btn-primary"
              disabled={courseBusy === "create" || !teacherProfile?.profileComplete}
            >
              {courseBusy === "create" ? <Loader2 size={16} className="spin" /> : <BookOpen size={16} />}
              {editingCourseId ? "Save course" : "Create course"}
            </button>
            {editingCourseId && (
              <button type="button" className="btn btn-ghost" onClick={cancelCourseEdit}>
                <X size={16} /> Cancel edit
              </button>
            )}
          </div>
        </form>

        <label className="course-label" htmlFor="course-select">Manage course</label>
        <select
          id="course-select"
          className="input course-select"
          value={selectedCourseId}
          onChange={(e) => {
            setSelectedCourseId(e.target.value);
            if (editingCourseId) cancelCourseEdit();
          }}
        >
          <option value="">Select a course</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name} · {course.subject} · Year {course.year || "—"} {course.branch || ""}
              {course.section ? ` · ${course.section}` : ""}
            </option>
          ))}
        </select>

        {selectedCourse && (
          <>
            <div className="course-management-row">
              <p className="muted course-description">
                {selectedCourse.subject}
                {selectedCourse.year ? ` · Year ${selectedCourse.year}` : ""}
                {selectedCourse.branch ? ` · ${selectedCourse.branch}` : ""}
                {selectedCourse.section ? ` · Section ${selectedCourse.section}` : ""}
                {selectedCourse.term ? ` · ${selectedCourse.term}` : ""}
                {" · "}{courseReport?.enrollments.length ?? selectedCourse.enrollmentCount} enrolled
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => editCourse(selectedCourse)}
              >
                <Pencil size={14} /> Edit details
              </button>
            </div>
            <form className="enroll-form" onSubmit={enrollStudent}>
              <input
                className="input course-input"
                type="email"
                placeholder="Registered student's email"
                value={studentForm.studentEmail}
                onChange={(e) => setStudentForm({ ...studentForm, studentEmail: e.target.value })}
                required
              />
              <input
                className="input course-input"
                placeholder="Roll number"
                value={studentForm.rollNumber}
                onChange={(e) => setStudentForm({ ...studentForm, rollNumber: e.target.value })}
                maxLength={80}
                required
              />
              <button
                className="btn btn-ghost"
                disabled={courseBusy === "enroll"}
              >
                {courseBusy === "enroll" ? <Loader2 size={16} className="spin" /> : <UserPlus size={16} />}
                Enroll student
              </button>
            </form>
            <p className="muted course-help">
              Students can also find this course in their dashboard. Roll numbers are unique within this course.
            </p>

            <div className="course-roster">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <h3><CalendarCheck size={16} /> Roster &amp; attendance</h3>
                <span className="muted">{courseReport?.sessionCount || 0} sessions held</span>
              </div>
              {!courseReport?.enrollments?.length ? (
                <p className="muted" style={{ marginTop: 10 }}>No enrolled students yet.</p>
              ) : (
                <ul className="list">
                  {courseReport.enrollments.map((student) => {
                    const records = student.records;
                    return (
                    <li key={student.studentId}>
                      <div className="meta">
                        <b>{student.rollNumber} · {student.name}</b>
                        <span>{student.email}</span>
                      </div>
                      <div className="course-stats">
                        <b>{student.percentage}%</b>
                        <span>{student.present} present · {student.absent} absent</span>
                      </div>
                      <details className="student-attendance-details">
                        <summary aria-label={`View attendance record for ${student.name}`}>
                          <ChevronDown size={16} />
                          <span>Records</span>
                        </summary>
                        <ul>
                          {!Array.isArray(records) && (
                            <li className="muted">Per-session records are unavailable from the server.</li>
                          )}
                          {Array.isArray(records) && records.length === 0 && (
                            <li className="muted">No sessions held since enrollment.</li>
                          )}
                          {Array.isArray(records) && records.map((record) => (
                            <li key={record.sessionId}>
                              <span>
                                {record.title}
                                <small>{fmtDate(record.startedAt)}</small>
                              </span>
                              <b className={record.present ? "record-present" : "record-absent"}>
                                {record.present ? "Present" : "Absent"}
                                {record.markedAt ? ` · ${fmtTime(record.markedAt)}` : ""}
                              </b>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </section>}

      {activeSection === "attendance" && <div className="attendance-section">
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
                {active.courseName && <p className="muted">{active.courseName}</p>}
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
                <label className="course-label" htmlFor="session-course">Course</label>
                <select
                  id="session-course"
                  className="input course-select"
                  value={selectedCourseId}
                  onChange={(e) => setSelectedCourseId(e.target.value)}
                  required
                >
                  <option value="">Select a course</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name} · {course.subject} · Year {course.year || "—"} {course.branch || ""}
                      {course.section ? ` · ${course.section}` : ""}
                    </option>
                  ))}
                </select>
                {courses.length === 0 && (
                  <p className="muted course-help">Create a course above before starting attendance.</p>
                )}
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
                      onClick={detectLocationFromButton}
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
                      onClick={detectLocationFromButton}
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
                      onClick={detectLocationFromButton}
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
                disabled={busy === "start" || locStatus === "detecting" || !courses.length}
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
                          {s.courseName ? `${s.courseName} · ` : ""}
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
                        <span>{p.rollNumber ? `${p.rollNumber} · ` : ""}{p.email}</span>
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
      </div>}
    </>
  );
}
