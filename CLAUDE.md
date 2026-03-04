# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AutoAlert is a React Native (Expo) mobile app for tracking vehicle check engine codes (DTCs). It has a Node.js/Express backend with PostgreSQL for user auth and vehicle management.

## Commands

### Frontend (React Native / Expo)
```bash
# Run from project root
npx expo start          # Start dev server (choose platform interactively)
npx expo start --ios    # iOS simulator
npx expo start --android
npx expo start --web
```

### Backend (Express API)
```bash
cd backend
node server.js          # Start backend server (port 3001)
# No dev watcher configured — add nodemon manually if needed
```

### Database seed
```bash
cd backend
node seed_dtc.js   # creates dtc_codes table + inserts 20 OBD2 codes (idempotent)
```

### No test suite is configured yet.

## Architecture

### Stack
- **Frontend:** React Native + Expo (v55), React Navigation (native stack), Axios, expo-secure-store
- **Backend:** Express v5, PostgreSQL (`pg`), JWT auth (`jsonwebtoken`), `bcryptjs`
- **Database:** PostgreSQL, accessed via `pg` connection pool

### Frontend (`src/`)

```
src/
├── api/client.js          # Axios instance; platform-aware base URL
│                          #   Web: http://localhost:3001/api
│                          #   Mobile: http://192.168.1.198:3001/api
├── context/AuthContext.js # Global auth state; JWT storage + /auth/me session restore
└── screens/               # One file per screen
```

**Navigation flow (App.js):**
- Unauthenticated: `LoginScreen` ↔ `RegisterScreen`
- Authenticated: `HomeScreen` → `DTCDetailScreen`, `VehicleScreen`

**Auth state** is held in `AuthContext` (user, token, loading, appReady). Tokens are stored in `expo-secure-store` on mobile and `localStorage` on web.

### Backend (`backend/`)

```
backend/
├── server.js              # Express entry point, mounts routes
├── config/db.js           # pg Pool; reads DB_HOST/PORT/NAME/USER/PASSWORD from .env
└── routes/
    ├── auth.js            # POST /auth/register, POST /auth/login, GET /auth/me
    └── vehicles.js        # CRUD for /vehicles (all protected by JWT middleware)
```

**Auth middleware** validates `Authorization: Bearer <token>` on every protected route and attaches `req.user`.

**DTC routes** (`/api/dtc`) are public (no auth required):
- `GET /api/dtc` — all codes; `?severity=low|medium|high` to filter
- `GET /api/dtc/:code` — single code (case-insensitive)

### Database Schema

```sql
-- users: id, name, email (unique), password (bcrypt)
-- vehicles: id, user_id (FK), year, make, model, trim, mileage, created_at
-- dtc_codes: code (PK), short_description, description, possible_causes TEXT[],
--            symptoms TEXT[], severity (low/medium/high), urgency, repairs JSONB
```

No migration tool is configured; schema is managed manually. Run `node seed_dtc.js` to create `dtc_codes` and seed 20 OBD2 codes.

### DTC Data

DTC code details live in the `dtc_codes` PostgreSQL table. `DTCDetailScreen` fetches `/api/dtc/:code` on mount; `HomeScreen` still uses a small hardcoded list for the active alerts card list (descriptions, severity, urgency) — this can be wired to `GET /api/dtc` in the future.

## Environment

Backend reads from `backend/.env` (not committed):
```
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
JWT_SECRET
PORT (default 3001)
```

The mobile client's API base URL is hardcoded to a local IP (`192.168.1.198`) in `src/api/client.js` — update this when the network changes.
