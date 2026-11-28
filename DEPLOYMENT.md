# Deploy SmartAttendance

Vercel serves the React frontend. The browser sends API requests to FastAPI on Render, and Render connects to PostgreSQL on Supabase. You can set up all three from their dashboards without Docker.

## 1. Prepare GitHub

1. Commit the deployment files and push the branch you plan to deploy, normally `main`. Render and Vercel read the remote branch.
2. Keep `.env` files, database files, and credentials out of commits. `backend/attendance.db` is ignored in the current tree, but an older copy exists in Git history. Review the history before sharing the repository. Use a private repository while reviewing any historical student data, or publish the current source from a fresh repository without that history.
3. This guide starts with an empty hosted database. Local accounts, courses, and attendance stay in SQLite. If you need those records online, back up the SQLite file and plan a separate data migration before onboarding users.

## 2. Supabase | Create the database

1. Sign in at [Supabase](https://supabase.com/dashboard). Select **New project**, choose an organization, enter a project name such as `smartattendance`, generate a database password, and save it privately. Choose a region near your planned Render region and wait for provisioning.
2. In the project dashboard, open the **Data API** integration and turn off **Enable Data API**. SmartAttendance uses a PostgreSQL connection directly from Render.
3. Click **Connect** at the top of the project. Under the connection string options, select **Session pooler**, port **5432**, and copy the PostgreSQL URI. Preserve the exact username and hostname from the dashboard.
4. Replace the password placeholder with your database password. URL-encode the password component if it contains reserved characters. Append `?sslmode=require` if the URI has no query string, or `&sslmode=require` if it already has other parameters. Keep an existing `sslmode` parameter rather than adding it twice. The resulting shape is:

   ```text
   postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:5432/postgres?sslmode=require
   ```

5. Keep this value for Render's `DATABASE_URL`. FastAPI creates its tables on the first successful startup. Later, you can find `users`, `courses`, `enrollments`, `sessions`, and `attendance` in **Table Editor** under the `public` schema.

[Supabase PostgreSQL connection options](https://supabase.com/docs/guides/database/connecting-to-postgres) · [Supabase Data API settings](https://supabase.com/docs/guides/api/securing-your-api#disable-the-data-api)

## 3. Render | Deploy FastAPI

1. In the [Render dashboard](https://dashboard.render.com/), select **New → Blueprint**. Connect the GitHub repository, select your deploy branch, and use the root `render.yaml`. The Blueprint creates a Python Web Service named `smartattendance-api`.
2. Enter the prompted values.

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Full Supabase Session pooler URI from step 2 |
   | `FRONTEND_ORIGIN` | Your exact Vercel production origin, if known. Otherwise enter `https://smartattendance.example.invalid` until step 5 |
   | `TEACHER_SIGNUP_CODE` | A private random code that authorized teachers enter during registration |

   If you already have a private `backend/.env` containing `TEACHER_SIGNUP_CODE`, paste its value into Render. To create a new code, use `python -c "import secrets; print(secrets.token_urlsafe(32))"`. Render generates the separate `SECRET_KEY` for the Blueprint. Keep both secrets in Render.

3. Apply the Blueprint. Open the service's **Events** or **Logs** and wait for startup. Copy the assigned public URL, such as `https://smartattendance-api.onrender.com`.
4. Open the Render URL with `/healthz` appended. Expect HTTP 200 with `{"status":"ok"}` when the API can query Supabase.

If you prefer manual setup, use **New → Web Service**, connect the same repository, and enter these settings. Use one setup method to avoid creating duplicate services.

| Render field | Value |
| --- | --- |
| Language | Python |
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/healthz` |
| Environment Variables | The three prompted values above, plus `APP_ENV=production`, `PYTHON_VERSION=3.14.7`, and a separate random `SECRET_KEY` of at least 32 characters |

For manual setup, generate the signing secret with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Render supplies `PORT`. The Blueprint uses the Free instance, which can sleep after inactivity. Allow time for the first request to wake it before a demo. [Render Blueprints](https://render.com/docs/blueprint-spec) · [Render Web Services](https://render.com/docs/web-services) · [Render Free instances](https://render.com/docs/free)

## 4. Vercel | Deploy React

1. In the [Vercel dashboard](https://vercel.com/dashboard), select **Add New → Project** and import the same GitHub repository.
2. On **Configure Project**, set these values.

   | Vercel field | Value |
   | --- | --- |
   | Framework Preset | Vite |
   | Root Directory | `frontend` |
   | Node.js Version | 22.x, also specified in `package.json` |
   | Install Command | `npm ci` |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |
   | Production environment variable | `VITE_API_URL=https://YOUR-RENDER-HOST.onrender.com/api` |

3. Use the real Render hostname and include `/api` once. Add only the public API URL to Vercel. Vite includes `VITE_` values in the browser bundle.
4. Click **Deploy** and copy the stable URL shown under the project's production domains, such as `https://smartattendance.vercel.app`. The repository includes the SPA rewrite so refreshing `/teacher` or `/student/attendance` loads the app.
5. Under **Settings → Environment Variables**, keep **Automatically expose System Environment Variables** enabled for the production API URL build check. If you change `VITE_API_URL`, use **Deployments → Redeploy** on a production deployment so the new value is built into the frontend.

[Vercel Vite setup](https://vercel.com/docs/frameworks/frontend/vite) · [Vercel Root Directory](https://vercel.com/docs/monorepos) · [Vercel environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables) · [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables)

## 5. Render | Allow the Vercel site to call the API

1. Open **Render → your Web Service → Environment**.
2. Set `FRONTEND_ORIGIN` to the exact Vercel production address. Include `https://` and omit the trailing slash and any path. Save and redeploy, then wait for `/healthz` to return 200 again.
3. If using a custom domain, add that origin too if you serve the app from both domains. Separate exact origins with commas. Preview deployments need their own API URL and explicitly allowed origin to make API calls.

Replace both example hosts and run these checks:

```bash
curl -i https://YOUR-RENDER-HOST.onrender.com/healthz

curl -i -X OPTIONS https://YOUR-RENDER-HOST.onrender.com/api/auth/login \
  -H 'Origin: https://YOUR-VERCEL-HOST.vercel.app' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,authorization'
```

The first response should be HTTP 200 with `{"status":"ok"}`. The second should be HTTP 200 and include `Access-Control-Allow-Origin` with your exact Vercel origin.

## 6. Verify the attendance workflow

1. Open Vercel in a browser. Register a test student and a test teacher with the same branch. Use the private teacher code during teacher signup.
2. As the teacher, create a course matching the student's year and branch. Enroll the student with their email and a roll number.
3. Open the HTTPS Vercel site directly in the teacher device browser. Use the location button or start an attendance session and allow location access. On a nearby phone, sign in as the student and tap **Open camera & scan**. Allow camera access and then allow location access. Scan the current QR. If you previously denied a permission, reset it in the browser’s site settings and retry.
4. Check that the attendance row appears in the teacher view, then try the Excel export. Refresh a signed-in dashboard route to verify Vercel routing.
5. Confirm the test records in Supabase Table Editor. After a Render redeploy, verify the same accounts and attendance still exist.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Render startup fails or `/healthz` returns 503 | Read Render logs. Confirm the Supabase project is active, then check the Session pooler host, port 5432, project username, URL-encoded password, and SSL parameter. |
| Browser shows a CORS error | Compare the browser address bar to Render's `FRONTEND_ORIGIN` and retry after a Render deploy. Check `/healthz` directly to rule out backend startup or cold-start failures. |
| Login sends requests to Vercel, returns HTML, or returns 404 | Check the production `VITE_API_URL` in Vercel. It should point to Render and end in `/api`. Redeploy after correcting it. |
| Refreshing a dashboard route gives a Vercel 404 | Verify the root directory is `frontend` and the deployed commit contains `frontend/vercel.json`. |
| Teacher signup fails | Confirm the code exactly matches Render's `TEACHER_SIGNUP_CODE`. |
| Camera or location fails | Open the HTTPS production URL directly in the device browser, allow permissions, and scan the current QR while within the configured radius. |
