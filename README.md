# CareLine Backend (Login / Signup / OTP)

This is a minimal Node.js backend for your `index.html` CareLine auth UI.

## What it includes

- `POST /api/auth/signup/initiate` → validates input, generates OTP (demo) and returns it
- `POST /api/auth/signup/verify` → verifies OTP and creates a user
- `POST /api/auth/login` → mobile/email + password login
- File-based storage: `backend/data/users.json`

## Run (Windows PowerShell)

From the project root:

```powershell
cd backend
npm install
npm run dev
```

Backend starts at `http://localhost:5050`.

## Notes

- OTP is stored in memory (demo). Restarting the server clears pending OTPs.
- Responses return a demo `token` (not JWT). Replace with JWT/sessions when you’re ready.

