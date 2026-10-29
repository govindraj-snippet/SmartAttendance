import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e.response?.status === 401 && localStorage.getItem("token")) {
      localStorage.clear();
      window.location.href = "/";
    }
    return Promise.reject(e);
  }
);

export const errMsg = (e, fallback = "Something went wrong") => {
  const d = e.response?.data;
  if (d?.error) return d.error;
  if (Array.isArray(d?.detail)) return "Please check the details you entered";
  if (!e.response) return "Cannot reach the server. Is the backend running?";
  return fallback;
};

export default api;
