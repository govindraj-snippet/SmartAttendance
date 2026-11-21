import { BookOpen, LogOut, QrCode, ScanLine } from "lucide-react";
import { NavLink } from "react-router-dom";

export default function Layout({ children }) {
  const name = localStorage.getItem("name") || "User";
  const role = localStorage.getItem("role");

  const logout = () => {
    localStorage.clear();
    window.location.href = "/";
  };

  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <div className="logo">
            <div className="logo-mark"><QrCode size={20} /></div>
            QR Attendance
          </div>
          {role === "STUDENT" && (
            <nav className="student-nav" aria-label="Student sections">
              <NavLink to="/student/attendance" className={({ isActive }) => `student-nav-link${isActive ? " active" : ""}`}>
                <ScanLine size={16} /> Mark attendance
              </NavLink>
              <NavLink to="/student/courses" className={({ isActive }) => `student-nav-link${isActive ? " active" : ""}`}>
                <BookOpen size={16} /> Courses
              </NavLink>
            </nav>
          )}
          <div className="nav-right">
            <div className="who">
              <b>{name}</b>
              <span className="badge">{role}</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={logout}>
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
