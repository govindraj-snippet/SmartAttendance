import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./Login";
import Teacher from "./Teacher";
import Student from "./Student";
import StudentAttendanceHistory from "./StudentAttendanceHistory";
import Layout from "./Layout";

function Protected({ role, children }) {
  const token = localStorage.getItem("token");
  const myRole = localStorage.getItem("role");
  if (!token) return <Navigate to="/" replace />;
  if (myRole !== role) {
    if (myRole === "TEACHER") return <Navigate to="/teacher" replace />;
    if (myRole === "STUDENT") return <Navigate to="/student/attendance" replace />;
    return <Navigate to="/" replace />;
  }
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/teacher" element={<Protected role="TEACHER"><Teacher /></Protected>} />
        <Route path="/student" element={<Navigate to="/student/attendance" replace />} />
        <Route path="/student/attendance" element={<Protected role="STUDENT"><Student key="scanner" /></Protected>} />
        <Route path="/student/courses" element={<Protected role="STUDENT"><Student key="courses" /></Protected>} />
        <Route path="/student/history" element={<Protected role="STUDENT"><StudentAttendanceHistory /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
