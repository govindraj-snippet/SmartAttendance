import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./Login";
import Teacher from "./Teacher";
import Student from "./Student";
import Layout from "./Layout";

function Protected({ role, children }) {
  const token = localStorage.getItem("token");
  const myRole = localStorage.getItem("role");
  if (!token) return <Navigate to="/" replace />;
  if (myRole !== role) return <Navigate to={myRole === "TEACHER" ? "/teacher" : "/student"} replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/teacher" element={<Protected role="TEACHER"><Teacher /></Protected>} />
        <Route path="/student" element={<Protected role="STUDENT"><Student /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
