# Clipper

Private Node-first app for creating captioned MP4 clips from YouTube URLs.

## Workflow

Paste a public YouTube URL → Node/BullMQ worker retrieves video metadata, source media, and the best available timed caption track using yt-dlp → preview and edit cue text/timestamps → select in/out points and aspect ratio → worker trims/crops/burns captions with FFmpeg → download MP4.

Videos without accessible captions still import; export can be performed with captions disabled. This is *not* speech-to-text. YouTube availability can change; imports may fail for unavailable, restricted, DRM, or rate-limited videos. Import only videos you may use.

## Stack and layout

- Next.js 15 / TypeScript UI and API
- PostgreSQL 16 / Prisma (dedicated `clipper-db` container)
- Redis / BullMQ (one worker, one export at a time)
- yt-dlp with local EJS solver; FFmpeg 6.1
- Persistent source/export data: `/opt/clipper/data` (outside the app build)
- Local web listener: `127.0.0.1:3120`

Only the Clipper database is containerized. `.env` is local and untracked. No external site data is touched.

## Local setup

1. Install Node 24, FFmpeg, Redis, Python venv, Docker Compose.
2. Copy `.env.example` to `.env`, set strong unique secrets and actual paths. Keep mode 0600.
3. `python3 -m venv .venv && .venv/bin/pip install yt-dlp yt-dlp-ejs`
4. `npm ci && docker compose up -d db`
5. `npx prisma migrate deploy` (or `npx prisma db push` for a new development DB)
6. `npm run build`; start web with `npm start` and worker with `npm run worker`.

Production units are in `deploy/`. The web service binds localhost; the sample Nginx vhost must only be enabled after DNS points to the VPS and a TLS certificate is issued.

## Limits and data

Default import limit is 30 min/350 MiB. Exports are capped at 10 min. Imports/exports queue limits are 2/3; one worker processes jobs sequentially. Source and exports are **not automatically deleted**. Watch disk headroom. Back up the PostgreSQL database with `scripts/backup-db.sh`; also back up `/opt/clipper/data/sources` and `exports` to off-VPS storage. A backup on the same disk is not disaster recovery. Do not delete source media without owner approval.

## Verification

- `npm run typecheck && npm run build`
- `curl http://127.0.0.1:3120/api/health`
- Authenticated browser flow: URL → ready project with caption cues → edit/save → export → download.
- To check logs: `journalctl -u clipper-web -u clipper-worker -n 100 --no-pager`; `docker logs clipper-db`.
