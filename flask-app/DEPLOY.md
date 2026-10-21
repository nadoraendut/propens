# Deploying Audit Planner

This guide puts the app on a Linux server so lecturers can use it from a browser.
It uses Docker Compose, which gives you: the app, automatic HTTPS, a daily reminder job and automatic database backups.

## What you need
| Item | Notes |
|---|---|
| A Linux server or VM | 1 CPU / 1 GB RAM is enough. University IT may already provide one. |
| Docker + Docker Compose | `docker compose version` must work. |
| A DNS name | e.g. `audit.yourfaculty.edu.my`, pointing to the server. Ports **80 and 443** open. |
| SMTP details | Host, port, user and password of a mail account the app may send from (ask IT). |

> Marks and staff data are sensitive. Check your university's IT/data-protection rules before choosing where to host it, and ask IT to approve the server and the sending mail account.

## 1. Install
```bash
git clone <your repository URL> audit-planner && cd audit-planner
git checkout claude/charming-dirac-mlincy        # or main once merged
cp .env.example .env
nano .env                                        # set DOMAIN, SMTP_*, MAIL_FROM
docker compose up -d --build
```
Open `https://your-domain/healthz`; you should see `ok`. (The first HTTPS certificate takes a few seconds.)

## 2. Create the first accounts
```bash
docker compose exec app flask create-user ADMIN001 "Admin Name" --role admin --email admin@uni.edu
docker compose exec app flask create-user HOF001   "Head Name"  --role head  --email head@uni.edu
```
You are asked to type a password for each (min. 8 characters). Admin and Head are plain staff accounts with a role; run the command again for a second admin.

Lecturers are created by the admin (upload or *Lecturers > Add*). Their first password is their **Staff ID** and they are **forced to choose a new one at first login**. After 5 wrong passwords an account is locked for 15 minutes.

## 3. Check e-mail before go-live
```bash
docker compose exec app flask test-email your.address@uni.edu
```
It prints `Sent`, or the exact SMTP error. Until it says `Sent`, notifications only appear in the admin **Outbox** page and in the in-app alerts.

## 4. What runs automatically
* **Reminders:** the `scheduler` container sends session reminders (day before and day of the session) every 6 hours.
* **Backups:** the same container backs up the database every 6 hours into the `propens-data` volume (`/data/backups`), keeping the latest 60.
* **Restart:** all containers restart after a server reboot.

Backups on the same server are not enough if the server is lost. **Copy them off the server regularly** (a nightly cron job on the host is fine):
```bash
mkdir -p offsite-backups && docker compose cp scheduler:/data/backups/. ./offsite-backups   # then copy it to another machine
```

## 5. Restore a backup
```bash
docker compose stop app scheduler
docker compose run --rm --no-deps -v "$PWD/offsite-backups:/restore:ro" app \
  sh -c 'cp /restore/propens-YYYYMMDD-HHMMSS.db /data/propens.db && rm -f /data/propens.db-wal /data/propens.db-shm'
docker compose start app scheduler
```

## 6. Update to a new version
```bash
git pull && docker compose up -d --build
```
The database is upgraded automatically on start. **Take a backup first** (`docker compose exec app flask backup`).

## Useful commands
```bash
docker compose logs -f app          # live application log
docker compose ps                   # status and health
docker compose exec app flask send-reminders      # send due reminders now
docker compose exec app flask backup              # backup now
```

## Without Docker (alternative)
```bash
python3 -m venv venv && venv/bin/pip install -r requirements.txt
export PROPENS_DATA_DIR=/var/lib/propens PROPENS_HTTPS=1 PROPENS_BEHIND_PROXY=1 FLASK_APP=propens
venv/bin/gunicorn serve:app --bind 127.0.0.1:8000 --workers 2 --threads 4     # run under systemd
```
Put nginx/Apache in front for HTTPS (forward to port 8000), and add a cron entry for `flask send-reminders` and `flask backup`.

## Settings reference
| Variable | Meaning |
|---|---|
| `DOMAIN` | Public DNS name (Docker setup, used by the HTTPS proxy). |
| `SMTP_HOST/PORT/USER/PASSWORD/TLS`, `MAIL_FROM` | Outgoing e-mail. Empty `SMTP_HOST` = record only. |
| `SECRET_KEY` | Optional. If unset, a random key is created once and stored in the data volume. |
| `PROPENS_DATA_DIR` | Folder for the database, key and backups (must be persistent). |
| `PROPENS_HTTPS=1` | Marks session cookies secure. Set it whenever the site is served over HTTPS. |
| `PROPENS_BEHIND_PROXY=1` | Trust the reverse proxy's forwarded headers. |

## Not covered
* Single sign-on with a university account (users log in with Staff ID + password).
* High availability: the app uses one SQLite database on one server, which is fine for a faculty-sized user base.
