# Mini-project deployment guide

This project can be deployed as a static Vite frontend on Vercel, a FastAPI service on Render, and a PostgreSQL database on Supabase. Free hosting plans can sleep or have limits, so use this setup for a demo rather than critical attendance.

Vercel's Hobby plan is restricted by its terms to personal or non-commercial use; confirm that your academic demo qualifies before using it.

## 1. Prepare the repository

1. Push this project to a GitHub repository.
2. Keep the repository private if it contains real student data.
3. Do not commit `.env` files, passwords, database connection strings, or secret keys. The local `backend/attendance.db` is excluded from new commits; a newly deployed Supabase database starts empty.
4. If `backend/attendance.db` has ever contained real personal data in Git history, make the repository private and remove that data from history before publishing it.

## 2. Create the production database on Supabase

1. Create a Supabase project and save its database password privately.
2. In the Supabase dashboard, open **Connect** and copy a PostgreSQL connection URI. Use the session pooler URI if the direct connection is not reachable from Render.
3. Put that URI aside for the Render `DATABASE_URL` setting. URL-encode special characters in the password if the dashboard's URI instructions require it.
4. Do not add the connection URI to this repository or to the Vercel frontend.

The backend creates its tables and applies its current small compatibility migrations on startup. The existing SQLite database is not automatically copied to Supabase.

## 3. Deploy the backend to Render

1. In Render, choose **New → Blueprint** and connect the GitHub repository.
2. Render will read the root `render.yaml`; it defines the backend service, build/start commands, and health check.
3. When prompted for values, enter:
   - `DATABASE_URL`: the Supabase PostgreSQL URI
   - `FRONTEND_ORIGIN`: `https://<your-vercel-project>.vercel.app` (replace with the exact production URL you plan to use)
   - `SECRET_KEY`: generate a long random value locally, for example with `python -c "import secrets; print(secrets.token_urlsafe(48))"`
   - `TEACHER_SIGNUP_CODE`: a separate long random code, which you will give only to intended teacher users
4. Deploy. Wait for the service health check to pass.
5. Copy the Render service URL, for example `https://smartattendance-api.onrender.com`.
6. Visit that URL in a browser; the response should be `{"status":"ok"}`.

The app runs with `APP_ENV=production`. It refuses to start if the secret key, teacher signup code, or frontend origin is missing. Teacher registration requires the configured signup code.

## 4. Deploy the frontend to Vercel

1. In Vercel, choose **Add New → Project** and import the same GitHub repository.
2. Set **Root Directory** to `frontend`.
3. Select Vite if Vercel does not detect it automatically. Set the build command to `npm run build` and output directory to `dist`.
4. Add the environment variable `VITE_API_URL` with the value `https://<your-render-service>.onrender.com/api`.
5. Deploy and copy the production URL, such as `https://<your-vercel-project>.vercel.app`.

The `frontend/vercel.json` rewrite sends React Router paths such as `/teacher` back to `index.html`, so refreshing those pages works.

## 5. Connect and verify both services

1. In Render, set `FRONTEND_ORIGIN` to the exact Vercel production origin, with no trailing slash, and redeploy if necessary.
2. In Vercel, confirm `VITE_API_URL` points to the Render URL and redeploy after changing it. Vite embeds this value at build time.
3. Open the Vercel site, create a student account, then create a teacher account using the teacher signup code.
4. Create a course, enroll the student, start a session, and scan its QR code from a phone. Both services use HTTPS, which mobile browsers require for camera and location access.
5. If login or API calls fail, check Render logs and confirm `FRONTEND_ORIGIN`, `VITE_API_URL`, and `DATABASE_URL` are correct.

## Environment variable reference

| Variable | Set in | Purpose |
| --- | --- | --- |
| `APP_ENV` | Render | Must be `production` for deployment safeguards |
| `DATABASE_URL` | Render | Supabase PostgreSQL connection URI |
| `SECRET_KEY` | Render | Signs authentication and QR tokens |
| `TEACHER_SIGNUP_CODE` | Render | Restricts teacher account registration |
| `FRONTEND_ORIGIN` | Render | Exact Vercel origin permitted by CORS |
| `VITE_API_URL` | Vercel | Backend API base URL ending in `/api` |

Never set database credentials or signing secrets as `VITE_` variables; frontend variables are public in the built JavaScript.
