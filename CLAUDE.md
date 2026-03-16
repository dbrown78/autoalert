# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AutoAlert is a React Native (Expo) mobile app for tracking vehicle check engine codes (DTCs), OBD2 telemetry, and predictive maintenance. It has a Node.js/Express backend with PostgreSQL. The UI follows the **ODIN design system**: near-black backgrounds (`#080808`), silver (`#C0C0C0`) accents, uppercase tracking labels, square tab indicators.

## Commands

### Frontend (React Native / Expo)
```bash
npx expo start          # Start dev server (choose platform interactively)
npx expo start --ios
npx expo start --android
npx expo start --web
```

### Backend (Express API)
```bash
cd backend
node server.js          # Start backend server (port 3001 or $PORT)
node migrate_all.js     # Run all migrations + seeds in order (first-time setup)
```

See `backend/CLAUDE.md` for full backend architecture, route map, services, and schema.

## Architecture

### Stack
- **Frontend:** React Native + Expo (v55), React Navigation (native stack + bottom tabs), Axios, expo-secure-store
- **Backend:** Express v5, PostgreSQL (`pg`), JWT auth — see `backend/CLAUDE.md`

### Frontend (`src/`)

> **Important:** The screens directory is `src/Screens/` (capital S). App.js imports using lowercase `./src/screens/` — Metro resolves this on macOS (case-insensitive FS) but will break on Linux/CI.

```
src/
├── api/client.js          # Axios instance; always points to Railway production URL
│                          #   https://odin-backend-production-3220.up.railway.app/api
├── context/AuthContext.js # Global auth state; JWT storage + /auth/me session restore
├── Screens/               # One file per screen (capital S)
└── components/            # Shared card components
```

**Auth state** is held in `AuthContext` (user, token, loading, appReady). Tokens are stored in `expo-secure-store` on mobile and `localStorage` on web.

### Navigation (App.js)

- **Unauthenticated stack:** `LoginScreen` ↔ `RegisterScreen`
- **Authenticated:**
  - Bottom tabs: `HomeScreen`, `OBD2ScanScreen`, `TelemetryScreen`, `ForesightScreen`
  - Stack overlays (no tab bar): `DTCDetailScreen`, `MechanicFinderScreen`, `ScanHistoryScreen`

### Screens

| Screen | Description |
|---|---|
| `HomeScreen` | Active DTC alerts list; navigates to DTCDetail or MechanicFinder |
| `OBD2ScanScreen` | Manual DTC code lookup; records scan to history |
| `TelemetryScreen` | OBD2 live sensor readings display |
| `ForesightScreen` | Predictive alerts from rule-based telemetry analysis |
| `DTCDetailScreen` | Full DTC detail fetched from `/api/dtc/:code`; DIY repair links, cost estimate, drive safety |
| `MechanicFinderScreen` | Nearby shop search via `/api/mechanics`; shows ODIN Trust Score |
| `ScanHistoryScreen` | User's past scans from `/api/scans` |

### Components (`src/components/`)

| Component | Description |
|---|---|
| `DriveSafetyCard` | Red/amber/green "Is It Safe to Drive?" indicator |
| `DIYRepairCard` | DIY repair steps + YouTube search links |
| `CostComparisonCard` | Fair cost estimate vs. quoted price |
| `ForesightCard` | Single foresight alert display |

## Environment

Backend `.env` (not committed) — see `backend/CLAUDE.md` for full list. Key vars:
```
DATABASE_URL (or DB_HOST/PORT/NAME/USER/PASSWORD)
JWT_SECRET
GOOGLE_PLACES_API_KEY   # required for MechanicFinder
PORT                    # default 3001
```
