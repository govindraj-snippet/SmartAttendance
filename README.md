# SmartAttendance

SmartAttendance is a QR attendance app for courses. Teachers create courses, enroll students, start geofenced attendance sessions, and export attendance to Excel. Students scan a live QR code and share their location to mark attendance.

## Run locally

Use Python 3.14 and Node.js 22. From the repository root, open one terminal for the FastAPI backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload
```

The API runs at `http://127.0.0.1:8000`. Open `/healthz` to check database connectivity. Local development creates `backend/attendance.db` on first start if the file is missing.

In a second terminal, start the Vite frontend:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite proxies API calls to the local backend. For camera and location testing on a phone, use the deployed HTTPS site.

## Deploy

Follow the [deployment guide](DEPLOYMENT.md) to deploy the frontend to Vercel, the backend to Render, and the database to Supabase. The guide covers environment variables, database setup, and testing the full attendance flow.
