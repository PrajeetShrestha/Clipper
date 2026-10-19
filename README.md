# Clipper

Node-first app for creating MP4 clips from uploaded videos or direct video-file URLs.

## Workflow

Password login is currently disabled. Anyone with the site URL can access projects and media.

Upload a video file from your browser, or paste a public direct `.mp4`, `.m4v`, `.mov`, `.webm`, or `.mkv` file URL → Clipper validates it with ffprobe → OpenClaw transcribes and ranks speech moments → FFmpeg automatically renders up to five vertical MP4 clips for download. Existing YouTube projects and caption tracks remain available, but new YouTube and streaming-platform links are not imported. For those sources, download a video you are permitted to use and upload the file. New imports do not have burned-in captions; transcript TXT/SRT downloads are available after analysis.

Browser uploads stream to disk rather than buffering whole files. Direct URL downloads are limited to public network addresses, validated across redirects, size-capped, and probed before use.

## Stack and layout

- Next.js 15 / TypeScript UI and API
- PostgreSQL 16 / Prisma (dedicated `clipper-db` container)
- Redis / BullMQ (one worker, one export at a time)
- FFmpeg/ffprobe 6.1
- Persistent source/export data: `/opt/clipper/data` (outside the app build)
- Local web listener: `127.0.0.1:3120`

Only the Clipper database is containerized. `.env` is local and untracked. No external site data is touched.

## Local setup

1. Install Node 24, FFmpeg/ffprobe, Redis, Docker Compose.
2. Copy `.env.example` to `.env`, set strong unique secrets and actual paths. Keep mode 0600.
3. `npm ci && docker compose up -d db`
4. `npx prisma migrate deploy` (or `npx prisma db push` for a new development DB)
5. `npm run build`; start web with `npm start` and worker with `npm run worker`.

Production units are in `deploy/`. The web service binds localhost; the sample Nginx vhost must only be enabled after DNS points to the VPS and a TLS certificate is issued.

## Limits and data

Default import limit is 60 min/1 GiB (configurable with `MAX_SOURCE_DURATION` and `MAX_SOURCE_BYTES`). Exports are capped at 10 min. Imports are limited to two concurrent submissions; one worker processes import, analysis, and render jobs sequentially. Source and exports are **not automatically deleted**. Watch disk headroom. Back up the PostgreSQL database with `scripts/backup-db.sh`; also back up `/opt/clipper/data/sources` and `exports` to off-VPS storage. A backup on the same disk is not disaster recovery. Do not delete source media without owner approval.

## Verification

- `npm run typecheck && npm run build`
- `curl http://127.0.0.1:3120/api/health`
- Browser flow: file upload or direct video-file URL → automatic analysis → automatically rendered clips → download.
- To check logs: `journalctl -u clipper-web -u clipper-worker -n 100 --no-pager`; `docker logs clipper-db`.

## Production deployment

`https://clipper.codekunda.com` is served through Nginx/Let's Encrypt. The dedicated web and worker systemd units run on the VPS; PostgreSQL data and media stay outside Git.

Every push to `main` runs `.github/workflows/deploy.yml`: `npm ci`, typecheck, build, then an SSH deployment of that exact commit. The VPS accepts the Actions key only for `/usr/local/sbin/clipper-deploy` (forced command; no shell or forwarding). That command refuses dirty/non-fast-forward deployments, backs up the database before code updates, installs/builds, runs Prisma migrations, restarts the AI bridge, worker, and web units, and checks health. `workflow_dispatch` can rerun deployment of `main`.

GitHub repository setup: add the private key held at `/root/.ssh/clipper_ci` as the `VPS_SSH_KEY` Actions secret, then allow the `production` environment for the deploy job. Never commit the key or production `.env`. The VPS SSH host key is pinned in the workflow. If the VPS host key changes, verify and update that pin before redeploying.

For manual deployment, use the restricted SSH key with the full commit SHA as the remote command, or set `SSH_ORIGINAL_COMMAND=<sha>` when running `/usr/local/sbin/clipper-deploy` locally as root. Check `https://clipper.codekunda.com/api/health` after rollout.

## Automatic AI clips

The worker extracts 45-second audio windows, sends them over a `clipper`-group Unix socket to the dedicated `clipper-ai` service, and uses the VPS OpenClaw CLI for transcription and text ranking. OpenClaw credentials remain in the root-owned OpenClaw state; they are not copied into Clipper. The worker queues up to five 9:16 clip renders as soon as suggestions are generated. Manual trimming and export are removed. Transcript TXT/SRT timestamps are approximate window boundaries, not word-aligned. Speech-based ranking does not inspect visual action; videos without intelligible speech may fail analysis. AI ranking does not guarantee virality.

Install `deploy/clipper-ai.service` as `/etc/systemd/system/clipper-ai.service`, then `systemctl daemon-reload && systemctl enable --now clipper-ai`. The broker expects the local OpenClaw CLI at `/root/.openclaw/tmp/agent-cli/openclaw` and the `clipper_dev` agent to have working model and audio inference.
