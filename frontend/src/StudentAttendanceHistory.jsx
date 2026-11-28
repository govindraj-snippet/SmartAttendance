import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import api, { errMsg } from "./api";

export default function StudentAttendanceHistory() {
  const [request, setRequest] = useState({ loading: true });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.get("/student/attendance/history", { signal: controller.signal })
      .then(({ data }) => setRequest({ courses: data }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setRequest({ error: errMsg(error, "Could not load attendance") });
        }
      });
    return () => controller.abort();
  }, [revision]);

  function refresh() {
    setRequest({ loading: true });
    setRevision((value) => value + 1);
  }

  return (
    <>
      <div className="page-head dashboard-head">
        <h1>My attendance</h1>
        <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={request.loading}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <section className="card student-attendance-section" aria-label="Attendance by subject">
        {request.loading && <p className="muted" role="status">Loading attendance…</p>}
        {request.error && <p className="alert error" role="alert">{request.error}</p>}
        {request.courses?.length === 0 && (
          <p className="muted">You’re not enrolled in any courses yet. <Link to="/student/courses">Find your courses</Link>.</p>
        )}
        {request.courses?.length > 0 && (
          <div className="performance-table-wrap student-attendance-wrap">
            <table className="performance-table student-attendance-table">
              <thead>
                <tr>
                  <th scope="col">Subject</th>
                  <th scope="col">Classes conducted</th>
                  <th scope="col">Classes attended</th>
                  <th scope="col">Attendance</th>
                </tr>
              </thead>
              <tbody>
                {request.courses.map((course) => (
                  <tr key={course.id}>
                    <td>
                      <b>{course.subject}</b>
                      <span>{[course.courseName, course.section && `Section ${course.section}`, course.term].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td>{course.conducted}</td>
                    <td>{course.attended}</td>
                    <td className="attendance-rate"><b>{course.percentage === null ? "—" : `${course.percentage}%`}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
