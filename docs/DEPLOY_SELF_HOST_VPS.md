# Self-host Minutia on a VPS

Target server baseline:

- Linux VPS with Docker support
- Recommended minimum: 4 vCPU, 8 GB RAM, 80 GB SSD
- Public IPv4 or domain name for setup
- Ubuntu LTS or another Docker-supported Linux distribution

## Runtime Shape

Minutia runs as one Docker Compose project:

- `caddy`: public entrypoint on ports 80 and 443
- `minutia-web`: Next.js app, bound to localhost port 3000
- `supabase-kong`: Supabase API gateway, bound to localhost port 8000
- `supabase-auth`: GoTrue auth
- `supabase-rest`: PostgREST API
- `supabase-realtime`: Realtime socket API
- `supabase-db`: Postgres 15 with Minutia migrations

Caddy serves both the app and Supabase API on the same public origin:

- `/` routes to `minutia-web`
- `/auth/v1/*`, `/rest/v1/*`, `/realtime/v1/*` route to `supabase-kong`

## First Deploy

On the VPS:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
```

Clone and start Minutia:

```bash
git clone https://github.com/shiprite-dev/minutia.git
cd minutia
bash scripts/***.sh
```

Allow only SSH and web traffic:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

Open `http://203.0.113.10/setup`, replacing the example IP with the server IP, and complete the setup wizard.

## Domain Cutover

Point an `A` record at the server IP, then regenerate `.env` with HTTPS:

```bash
docker run --rm -v "$PWD:/work" -w /work node:22-alpine \
  node scripts/generate-self-host-env.mjs --out .env --url https://minutia.example.com --force
bash scripts/***.sh
```

Caddy will request and renew the TLS certificate automatically when the domain resolves to the VPS.

## Useful Commands

```bash
docker compose --env-file .env -f docker-compose.yml -f deploy/minutia/***.yml ps
docker compose --env-file .env -f docker-compose.yml -f deploy/minutia/***.yml logs -f caddy minutia-web supabase-db
docker compose --env-file .env -f docker-compose.yml -f deploy/minutia/***.yml pull
docker compose --env-file .env -f docker-compose.yml -f deploy/minutia/***.yml up -d --build
```

## Observability Checklist

Baseline production checks:

```bash
uptime
free -h
df -h /
docker ps --format "table {{.Names}}\t{{.Status}}"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}"
```

Recommended healthy baseline:

- Host load average should stay below the number of available vCPUs during normal traffic.
- Available memory should stay above `25%`; investigate sustained pressure below that threshold.
- Root disk should stay below `80%`; alert at `80%`, page at `90%`.
- `minutia-web`, `supabase-db`, `supabase-auth`, `supabase-kong`, and `caddy` should report `healthy`.
- Container memory should remain below `75%` of each configured limit during steady state.

Production gaps to close:

- Add swap so transient memory pressure does not OOM the database or app container.
- Add uptime checks for the app URL, `/login`, a known public share health URL, and the Supabase auth health endpoint.
- Add alerts for host CPU load, available memory, disk usage, container restarts, and Caddy 5xx spikes.
- Add Postgres backups plus restore verification, not only VPS-level backup.

## Backup Note

Provider-level backups protect the VPS, but Postgres still needs app-level backups before production use. At minimum, schedule `pg_dump` to object storage or another server.
