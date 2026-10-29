import { LogOut, QrCode } from "lucide-react";

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
