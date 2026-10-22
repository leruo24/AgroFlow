# AgroFlow farmer app

This Expo SDK 57 app is the farmer interface. The same source builds the Android
APK and the installable web app; Expo Router loads screens from `src/app`.

## Run

```powershell
cd apps/mobile
npm ci
Copy-Item .env.example .env
npm start
```

Use the Expo prompt to open Android or the web build. Local environment values
are public client configuration only; do not put server secrets in them.

## Test and build

```powershell
npx tsc --noEmit
npx jest
npx expo export --platform web
```

The web export is written to `dist/` for Vercel. Android release builds use the
profiles in `eas.json` through Expo Application Services.

## Main files

| Path | Purpose |
|---|---|
| `src/app/` | Expo Router layouts and screens; filenames are routes. |
| `src/components/` | Reusable farmer-interface components and component tests. |
| `src/context/` | Authentication, theme, farm, zone, and irrigation state. |
| `src/services/` | API, authentication, alerts, and insight clients. |
| `src/lib/` | Offline, formatting, routing, and setup helpers. |
| `src/i18n/` | English, Afrikaans, and Setswana translations. |
| `assets/`, `public/` | Native and web assets. |
| `app.json`, `eas.json`, `vercel.json` | Expo, APK-build, and web-deployment configuration. |
