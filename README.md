# SAM UI Manager

> **Important**
>
> - This project is **AI-generated / AI-assisted** (GPT-class models and similar coding assistants were used heavily).
> - It may contain mistakes, security gaps, and operational edge cases.
> - **Use at your own risk.**
> - Do not assume production-grade guarantees unless you review and harden it yourself.

A small local web dashboard for managing AWS SAM projects behind PM2.

It lets you register Git repositories, pick ports, deploy (`git` sync + `sam build` + restart), start/stop/restart local services, and read logs from one UI.

## Reality Check (No High Expectations)

This is a practical utility, not an enterprise platform.

- No built-in auth/RBAC in the API by default
- Limited error classification (many failures surface as `400`)
- Minimal persistence (`lowdb` JSON file)
- Best for local/internal trusted environments
- You should expect to troubleshoot your own environment setup

## What It Does Exactly

### Core workflow

1. You add a project in the UI (`name`, `repoUrl`, `branch`, `subdir`, `port`, auth mode).
2. The app stores metadata in `data/apps.json`.
3. On deploy:
   1. Validate target branch exists.
   2. Clone/fetch repository into `repos/<app-id>`.
   3. Run `sam build` in selected subdirectory.
   4. Restart process via PM2 running `sam local start-api`.
4. Logs are written to `data/logs/` and shown in UI.

### API surface

- `GET /api/meta`
- `GET /api/ports/suggest`
- `GET /api/ssh/keys`
- `POST /api/ssh/keys`
- `GET /api/apps`
- `GET /api/apps/:id/logs`
- `POST /api/apps`
- `PATCH /api/apps/:id`
- `POST /api/apps/:id/deploy`
- `POST /api/apps/:id/start`
- `POST /api/apps/:id/restart`
- `POST /api/apps/:id/stop`
- `POST /api/apps/:id/attachments`
- `DELETE /api/apps/:id/attachments/:attachmentId`
- `DELETE /api/apps/:id`

### Startup side effects

At startup, `src/config.js` creates required runtime files/directories if missing:

- `data/`
- `repos/`
- `data/logs/`
- `data/apps.json`
- `data/.secret.key`
- `data/git-askpass.cjs`

## Project Layout

- `server.js` - Express bootstrap (`/api` + static frontend)
- `src/config.js` - env/path config + runtime file bootstrap
- `src/routes.js` - API endpoint wiring
- `src/service.js` - orchestration logic (deploy/start/stop)
- `src/git.js` - clone/fetch and auth env handling
- `src/sam.js` - SAM validation/build/start args
- `src/pm2.js` - PM2 process control wrappers
- `src/model.js` - schema normalization + validation
- `src/secure.js` - AES-GCM secret encryption/decryption
- `src/db.js` - lowdb persistence
- `public/` - static dashboard UI
- `ops/systemd/` - optional systemd deployment files

## Prerequisites

Primary target: **Ubuntu 24.04**.

Any OS should work if it supports:

- modern Node.js (20+ recommended)
- `npm`
- `git`
- Docker Engine (running)
- AWS SAM CLI
- PM2 runtime (included as npm dependency; global `pm2` CLI optional)

## Ubuntu 24.04 Setup (Example)

Use this as a baseline and adapt versions to your standards.

```bash
# system packages
sudo apt update
sudo apt install -y git curl ca-certificates

# docker (example package name on Ubuntu)
sudo apt install -y docker.io
sudo systemctl enable --now docker

# Node.js: install via your preferred method (NodeSource, nvm, distro package, etc.)
# Then verify:
node -v
npm -v

# AWS SAM CLI install (official method may change over time)
# Follow AWS docs for current Ubuntu 24.04 instructions:
# https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html

# Verify tools
sam --version
docker info
git --version
```

## Install and Run

```bash
# clone your fork/repo
git clone <your-repo-url>
cd sam-ui-manager

# install Node dependencies
npm install

# optional environment overrides
export HOST=127.0.0.1
export PORT=8787

# start dashboard
npm start
```

Open:

- `http://127.0.0.1:8787`
- `http://127.0.0.1:8787/api/meta`

## Configuration

Environment variables:

- `HOST` (default: `127.0.0.1`)
- `PORT` (default: `8787`)

Useful behavior notes:

- Empty app port in UI auto-selects from `58000-58999`.
- `subdir` is sanitized and cannot include `..`.
- HTTPS credentials/tokens are stored encrypted in local JSON DB.

## Authentication Modes for Git

- `public` - no credentials
- `https_credentials` - username + password/token via askpass
- `https_token` - token via askpass
- `ssh` - existing host SSH keys / agent

Accepted SSH remote formats include:

- `git@github.com:org/repo.git`
- `gitea@git.doar.systems:yosef/test_sam_lambdas.git`
- `ssh://user@host/org/repo.git`

No root privileges are required for Git authentication. The app runs Git as the same OS user running `sam-ui-manager`, using either:

- that user's existing SSH keys / `ssh-agent`, with a fixed non-interactive `GIT_SSH_COMMAND`
- or non-interactive HTTPS auth via `GIT_ASKPASS`

For SSH remotes, the app also auto-trusts first-seen Git hosts using `StrictHostKeyChecking=accept-new` and stores them in `data/ssh-known-hosts`. This removes the usual first-connect host-key prompt while still refusing changed host keys later.

When `ssh` mode is selected in the UI, you can:

- click **Show Available Public Keys** to list usable keys found in `~/.ssh/*.pub` and `ssh-agent`
- click **Generate SSH Key If Missing** to auto-create `~/.ssh/id_ed25519` when no key is available

The UI also auto-checks keys when you switch to `ssh` mode and auto-generates one if none are found.

This avoids manual SSH login steps just to discover or bootstrap a public key.

## Logs and Data

Runtime files are local and persistent:

- app database: `data/apps.json`
- encryption key: `data/.secret.key`
- deploy logs: `data/logs/<app-id>.deploy.log`
- process logs: `data/logs/<app-id>.pm2.out.log`, `data/logs/<app-id>.pm2.err.log`
- SSH known hosts cache: `data/ssh-known-hosts`
- cloned repos: `repos/<app-id>/`

## Remote URL Attachments (Built-in Proxy)

Each app can expose additional plain-HTTP endpoints without nginx.

- Add one or more attachments per app (`bindHost` + `bindPort`) in the project card.
- Each attachment is a transparent 1:1 proxy to the app local SAM URL.
- Delete an attachment to immediately stop listening on that host/port.

Notes:

- No SSL/TLS handling is included.
- Proxying is HTTP-only and intentionally minimal.
- Use `0.0.0.0` to listen on all interfaces, or a specific interface IP to limit scope.

## Known Risks and Limitations

- Not hardened for internet exposure
- No default authentication layer on the dashboard/API
- Startup can fail if configured port is already used
- Depends on external tools and local machine state
- File permissions/ownership can break deploys
- AI-generated code means behavior may be inconsistent in edge cases

## Troubleshooting

### `ERR_MODULE_NOT_FOUND` (example: `express`)

Dependencies are missing.

```bash
npm install
```

### `EADDRINUSE 127.0.0.1:8787`

Port is already in use.

```bash
export PORT=8788
npm start
```

### `SAM CLI is not installed or not on PATH`

Install SAM CLI and ensure `sam --version` works in same shell.

### `Docker is not running or not reachable`

Start Docker and confirm `docker info` succeeds.

### Deploy fails with branch/subdirectory/template errors

Check:

- repo URL and branch are correct
- configured subdirectory exists
- `template.yaml` or `template.yml` exists in that subdirectory

## systemd (Optional, Linux)

There are sample files under `ops/systemd/`.

High-level flow:

1. Copy project to `/opt/sam-ui-manager`
2. Run `npm install --omit=dev`
3. Copy `ops/systemd/sam-ui-manager.service` to `/etc/systemd/system/`
4. Copy `ops/systemd/sam-ui-manager.env.example` to `/etc/default/sam-ui-manager`
5. `sudo systemctl daemon-reload`
6. `sudo systemctl enable --now sam-ui-manager`

## Safe Usage Recommendations

- Keep this bound to localhost unless you add authentication/reverse proxy hardening
- Run under a dedicated OS user
- Restrict filesystem permissions on `data/` and `repos/`
- Back up `data/apps.json` and `data/.secret.key` together
- Review all pull requests manually (especially AI-assisted changes)

## Final Disclaimer

This repository is intentionally shared with modest expectations.

It is useful as a personal/internal tool and a starting point, but it is not guaranteed to be correct, secure, or production-ready. The implementation was generated with significant AI assistance (GPT-class and similar models), and you should treat it as such: review, test, and harden before relying on it.

