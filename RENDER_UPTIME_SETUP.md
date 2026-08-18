# Render and UptimeRobot setup

The app now exposes a lightweight health endpoint:

```text
GET /healthz
HEAD /healthz
```

It returns HTTP `200` while the Render Node process is responding. It does not query Supabase, load the whiteboard, or read application files.

## Render

Set the service health-check path to:

```text
/healthz
```

Keep the existing production build and start commands that are already working for the project.

## UptimeRobot

Use:

```text
https://YOUR-RENDER-DOMAIN/healthz
```

Recommended monitor configuration:

- Monitor type: HTTP(S)
- Method: GET
- Expected status: 200
- Interval: 5 minutes on the free UptimeRobot plan

A temporary alert can still happen during a Render free-service restart, deployment, platform incident, or unusually slow cold start. The health endpoint reduces false alerts caused by loading the full React application.

## Security changes included

- Removed the public browser log upload endpoint.
- Removed the public log-reading endpoint.
- Removed synchronous file logging from the Render process.
- Removed browser monkey-patching of `console.error` and `console.warn`.
- Limited the AI-stamp JSON body to 32 KB.
- Added basic AI request validation.
- Added a WebSocket payload limit and rejected non-`/ws` upgrades.
- Added graceful `SIGTERM` and `SIGINT` shutdown handling.
- Added a production check that fails clearly when `dist/index.html` is missing.
- Added batched asset metadata hydration and the persistent identity-scoped media cache.

The application changes require the ordered
`202608080001_free_tier_concurrency_optimizations.sql` migration on existing
Supabase projects. Apply only that new migration; do not rerun the root schema.
