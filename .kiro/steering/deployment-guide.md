---
inclusion: auto
---

# NCAA Players Club — Deployment Guide

## Hosting

- Platform: Railway (https://railway.com)
- Project name: `ncaa-players-club`
- Production URL: https://ncaa-players-club-production.up.railway.app
- Railway dashboard: https://railway.com/project/b853d132-9c0a-4145-afb3-fea9fcd4c938

There is also a separate, older deployment at `ncaa-api-production-352e.up.railway.app` under the `eloquent-courtesy` Railway project. That is the original site and should NOT be modified from this repo.

## GitHub Repository

- Repo: https://github.com/dk3ll/ncaa-players-club (private)
- Branch: `main`
- SSH push: `GIT_SSH_COMMAND="ssh -i ~/.ssh/github_key" git push origin main`

## How Deploys Work

Deploys are triggered manually via the Railway CLI:

```bash
cd ~/Desktop/Kiro/ncaa-players-club
railway up
```

This pushes the local working directory to Railway and triggers a build. Railway auto-detects Bun and runs `bun run start` (`NODE_ENV=production bun src/index.ts`).

There is no auto-deploy on git push. You must run `railway up` after pushing to GitHub.

## Typical Deploy Workflow

1. Make code changes
2. Test locally: `bun run dev`
3. Lint: `bun run lint`
4. Commit: `git add -A && git commit -m "description"`
5. Push to GitHub: `GIT_SSH_COMMAND="ssh -i ~/.ssh/github_key" git push origin main`
6. Deploy: `cd ~/Desktop/Kiro/ncaa-players-club && railway up`
7. Verify: invoke the `e2e-test` agent or check the production URL

## Environment Variables

Set on Railway via `railway variables --set "KEY=VALUE"` from the project directory.

| Variable | Value | Notes |
|----------|-------|-------|
| `PORT` | `3000` | Required. App listens on 3000, Railway routes to it |
| `ADMIN_USER` | (not set, defaults to `admin`) | Optional. Admin login username |
| `ADMIN_PASS` | (not set, defaults to `ncaa2026`) | Optional. Admin login password |
| `NCAA_HEADER_KEY` | (not set) | Optional. If set, all API requests must include `x-ncaa-key` header |
| `RAILWAY_VOLUME_MOUNT_PATH` | (not set) | Auto-set by Railway if a volume is attached. Used for persistent data storage (draft rooms, registrations, feedback). Falls back to `./data` locally |

To add a persistent volume (recommended for draft data):
- Go to Railway dashboard → service → Settings → Volumes
- Mount path: `/app/data`

## Local Development Requirements

| Tool | Install | Purpose |
|------|---------|---------|
| Bun | `curl -fsSL https://bun.sh/install \| bash` | Runtime & package manager |
| Homebrew | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` | macOS package manager |
| Railway CLI | `brew install railway` | Deploy & manage Railway |
| GitHub CLI | `brew install gh` | Repo management |
| Git | Xcode CLI tools (`xcode-select --install`) | Version control |

## Railway CLI Setup

```bash
railway login          # Authenticate (opens browser)
railway link           # Link local dir to Railway project (interactive)
railway status         # Check current project/service
railway logs           # View deployment logs
railway variables      # View env vars
railway up             # Deploy
```

## Project Structure

```
src/
├── index.ts              # Main ElysiaJS server, all route wiring
├── codes.ts              # Sport/division mappings, GraphQL hashes
├── openapi.ts            # OpenAPI docs
├── scoreboard/           # NCAA scoreboard GraphQL integration
├── dashboard/            # Tournament draft dashboard (DO NOT MODIFY)
│   ├── dashboard.ts      # Builds player stats from boxscores
│   ├── picks.ts          # 2026 draft picks data
│   └── index.html        # Dashboard UI
├── betadraft/            # Beta draft room system
│   ├── draftroom.ts      # Room state, SSE, draft logic
│   ├── playerpool.ts     # Builds player pool from tournament boxscores
│   ├── storage.ts        # JSON file persistence (Railway volume)
│   ├── types.ts          # TypeScript interfaces
│   └── index.html        # Draft room UI
└── admin/                # Admin panel
    ├── admin.ts          # Auth, feedback, dashboard data
    ├── index.html        # Login page
    └── dashboard.html    # Admin dashboard (post-login)
```

## Key URLs

| Path | Description |
|------|-------------|
| `/` | Redirects to `/openapi` |
| `/openapi` | Interactive API documentation |
| `/dashboard` | Tournament draft dashboard (static picks, DO NOT MODIFY) |
| `/betadraft` | Beta draft room — create/join live drafts |
| `/admin` | Admin panel (login required) |
| `/league/:id` | League standings page (created after draft finalization) |

## Testing

Run the `e2e-test` agent in Kiro to verify all endpoints after a deploy. It tests the full API, dashboard, betadraft flow (register → create → join), and admin routes.

Locally: `bun test`
