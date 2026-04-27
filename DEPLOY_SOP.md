# Sealos Deployment SOP

This SOP is for `remy-year-frame` production deployment on Sealos.

## Quick Release Checklist (10 Items)

- [ ] Production DB backup is completed before release.
- [ ] New app image is built and pushed with a unique tag.
- [ ] Sealos app uses the new tag (not a local-only image).
- [ ] Production env vars are complete and correct.
- [ ] `DB_NAME` remains `remy_year_frame`.
- [ ] Persistent volume is mounted at `/app/public/uploads`.
- [ ] `/api/health` returns `status: ok` and `database: connected`.
- [ ] Login works and session persists after page refresh.
- [ ] At least one create/update action is verified in production.
- [ ] Last stable image tag is recorded for rollback.

## 0. Scope and Principles

- Production app runs on Sealos container service.
- Production database runs on Sealos managed MySQL.
- App release must not overwrite production data.
- Always keep rollback image tags.

## 1. One-Time First Release (Go-Live)

### 1.1 Prerequisites

- Sealos workspace is available.
- Managed MySQL instance is running.
- Docker is installed locally.
- MySQL client tools are installed locally (`mysql`, `mysqldump`).

### 1.2 Required Production Variables

- `NODE_ENV=production`
- `PORT=3088`
- `DB_HOST=<sealos mysql internal host>`
- `DB_PORT=3306`
- `DB_USER=<db user>`
- `DB_PASSWORD=<db password>`
- `DB_NAME=remy_year_frame`
- `SESSION_SECRET=<long random string>`

### 1.3 Data Migration (Local -> Sealos MySQL)

1) Export local DB:

```bash
cd "/Users/ewen/Desktop/My Project/remy-year-frame"
export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"
mysqldump -u root -p --databases remy_year_frame > remy_year_frame.sql
```

2) Import to Sealos MySQL (using external endpoint when needed):

```bash
mysql -h <PUBLIC_HOST> -P <PUBLIC_PORT> -u <DB_USER> -p -e "CREATE DATABASE IF NOT EXISTS remy_year_frame DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -h <PUBLIC_HOST> -P <PUBLIC_PORT> -u <DB_USER> -p remy_year_frame < remy_year_frame.sql
mysql -h <PUBLIC_HOST> -P <PUBLIC_PORT> -u <DB_USER> -p -e "USE remy_year_frame; SHOW TABLES;"
```

### 1.4 Build and Push App Image

```bash
cd "/Users/ewen/Desktop/My Project/remy-year-frame"
docker build -t <registry-user>/remy-year-frame:1.0.0 .
docker push <registry-user>/remy-year-frame:1.0.0
```

### 1.5 Deploy on Sealos

- Image: `<registry-user>/remy-year-frame:1.0.0`
- CPU/Memory: `1C/1G` (initial)
- Container port: `3088`
- Public access: enabled
- Environment variables: fill all items in section 1.2
- Persistent volume mount: `/app/public/uploads` (at least 10G)

### 1.6 Go-Live Validation

- `GET /api/health` returns:
  - `status: ok`
  - `database: connected`
- Login page loads normally.
- CRUD on one core module works (e.g. activities or inventory).
- Uploaded images remain after pod restart.

## 2. Iterative Release SOP (Daily/Weekly)

### 2.1 Pre-Release Checklist

- Local features pass smoke tests.
- Database changes are written as migration scripts.
- Production DB backup is completed.
- Target release tag is confirmed (e.g. `1.0.1`).

### 2.2 Backup Production DB

```bash
mysqldump -h <PUBLIC_HOST> -P <PUBLIC_PORT> -u <DB_USER> -p --databases remy_year_frame > backup-remy_year_frame-$(date +%F-%H%M).sql
```

### 2.3 Build and Push New Image

```bash
cd "/Users/ewen/Desktop/My Project/remy-year-frame"
docker build -t <registry-user>/remy-year-frame:<new-tag> .
docker push <registry-user>/remy-year-frame:<new-tag>
```

### 2.4 Apply DB Migrations (Only If Needed)

- Use idempotent SQL or script-based migrations.
- Run migrations before switching traffic to new app version.
- Verify schema quickly after migration.

### 2.5 Update Sealos App Image

- Change image to `<registry-user>/remy-year-frame:<new-tag>`
- Keep env vars and volume mount unchanged
- Deploy and wait for service healthy

### 2.6 Post-Release Verification

- `GET /api/health`
- Login session works
- At least one write operation works
- Key list page loads with expected data

## 3. Rollback SOP

When release has critical issue:

1) In Sealos app settings, switch image tag back to last stable version.
2) Redeploy immediately.
3) Recheck `/api/health` and login/write path.
4) If issue is migration-related, stop further writes and evaluate DB rollback from backup.

## 4. Data Safety Rules (Must Follow)

- Never reinitialize production DB during normal release.
- Never delete production persistent volume for uploads.
- Never deploy with missing DB env vars.
- Never use test credentials in production.

## 5. Common Failure Quick Fixes

- Image pull timeout: use a reachable base image mirror and repush.
- `database: disconnected`: verify `DB_HOST/PORT/USER/PASSWORD/DB_NAME` and network.
- Login loop in production: ensure `NODE_ENV=production`, `SESSION_SECRET` exists, and proxy trust is enabled in app.
- Missing images after deploy: verify `/app/public/uploads` is mounted as persistent volume.

## 6. SOP Change Log

- `v1.0` Initial SOP for Sealos go-live and iterative releases.

