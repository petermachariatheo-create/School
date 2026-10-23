# Deployment

The whole system is one process on one machine. There is no container to
orchestrate, no database server to provision and no external service to
configure.

## Requirements

| Requirement                       | Why                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| Node.js 24 or later               | The server runs TypeScript directly and uses the built-in `node:sqlite` module.     |
| A writable directory for the data | The SQLite database and its backups.                                                |
| A network the clients can reach   | The server binds `0.0.0.0` by default so that other devices on the LAN can connect. |

Node 24 is a hard requirement: the server executes `.ts` files natively and
uses `node:sqlite`, which is not in earlier releases. Check with:

```bash
node --version
```

The Windows installer carries its own copy of the Node runtime, so a school
machine needs nothing installed — see [installing on a school
machine](#installing-on-a-schools-windows-machine) below.

## Installing on a school's Windows machine

`dist/windows/SchoolManager-Setup.exe` is the deliverable for a school. It is
one file, it needs nothing pre-installed, and it installs everything a
teacher or administrator needs.

```bash
npm run package
```

builds it and then checks it. The build needs the .NET Framework C# compiler,
which is present on a machine with the developer pack installed; set
`SCHOOL_CSC` to the path of `csc.exe` if it is somewhere else.

What the installer does:

| Step                   | What it does                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| Copies the application | Into `%LOCALAPPDATA%\Programs\School Manager` (or `%ProgramFiles%` with `--all-users`).                        |
| Writes the settings    | `config.txt` beside the application, holding the port it should use.                                           |
| Creates a certificate  | A self-signed certificate for this machine's addresses, trusted locally, and saved so a phone can be given it. |
| Creates shortcuts      | On the desktop, in the Start menu, and — unless `--no-startup` is given — at sign-in.                          |
| Starts the application | The launcher starts the server and opens the school in the default browser.                                    |

The data lives in the `data` folder beside the application, so a copy of the
folder is a copy of the school. That folder holds the database, its backups,
`server.log` and `launcher.log`.

To remove it:

```bash
"SchoolManager-Setup.exe" --uninstall
```

### The certificate, and why a phone needs it

A browser only allows a web application to be installed, and to keep working
with no network, when it is served from a **secure origin**. On a school
network that means HTTPS with a certificate the device trusts.

The installer's certificate is valid for `localhost`, the machine's name and
every address the machine has. To let a phone or tablet run the school
offline, open the server's address in the phone's browser once, download
`/certificate.cer`, and install it as a trusted certificate. After that the
phone can be given the secure address (`https://<address>:8443`) and will
run the application with no network at all.

Without the certificate the plain address still works, but only while the
phone can reach the server.

### When the launcher says it could not start

The launcher starts the server, waits for it to answer, and then opens the
browser. If it reports that the server did not answer, the reason is in the
`data` folder:

- `data/launcher.log` — what the launcher did.
- `data/server.log` — what the server said, including why it could not start
  a part of itself.

## Installing from the repository

```bash
git clone <repository> school
cd school
npm install
npm run build
```

`npm install` needs no compiler and no build tools: the only dependency that
would normally need a native build is not used, because the database driver is
built into Node.

## Configuring

Every setting is an environment variable. There is no configuration file to
edit, so a deployment is reproducible from its environment.

| Variable                        | Default       | Meaning                                                                                                                                                |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SCHOOL_HOST`                   | `0.0.0.0`     | The interface to bind. `0.0.0.0` lets other devices on the LAN connect.                                                                                |
| `SCHOOL_PORT`                   | `8080`        | The port to listen on.                                                                                                                                 |
| `SCHOOL_DATA_DIR`               | `<repo>/data` | Where the database and the backups live.                                                                                                               |
| `SCHOOL_SQLITE_SYNCHRONOUS`     | `NORMAL`      | `NORMAL` survives an application crash; `FULL` also survives a power cut, at the cost of one storage sync per commit.                                  |
| `SCHOOL_SYNC_BATCH_SIZE`        | `500`         | The maximum number of changes returned by one sync pull.                                                                                               |
| `SCHOOL_CLIENT_RETENTION_DAYS`  | `30`          | How long an inactive client's progress is remembered, which bounds how far the change log may be pruned.                                               |
| `SCHOOL_WAL_AUTOCHECKPOINT`     | `4000`        | The write-ahead log size, in pages, at which SQLite checkpoints if the background checkpointer is not running. See [tuning](../performance/tuning.md). |
| `SCHOOL_CHECKPOINT_INTERVAL_MS` | `5000`        | How often the background checkpointer copies the write-ahead log into the database file. See [tuning](../performance/tuning.md).                       |

Example:

```bash
SCHOOL_PORT=8080 SCHOOL_DATA_DIR=/var/lib/school node packages/server/src/index.ts
```

## Running

### As a service on Linux (systemd)

```ini
# /etc/systemd/system/school.service
[Unit]
Description=School Manager
After=network.target

[Service]
Type=simple
User=school
WorkingDirectory=/opt/school
Environment=SCHOOL_DATA_DIR=/var/lib/school
Environment=SCHOOL_PORT=8080
ExecStart=/usr/bin/node packages/server/src/index.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now school
sudo journalctl -u school -f
```

The service should run as a dedicated unprivileged user, and the data
directory should be owned by that user.

### As a service on Windows (NSSM or the Task Scheduler)

```powershell
nssm install SchoolManager "C:\Program Files\nodejs\node.exe" "C:\school\packages\server\src\index.ts"
nssm set SchoolManager AppDirectory C:\school
nssm set SchoolManager AppEnvironmentExtra SCHOOL_DATA_DIR=C:\school\data
nssm start SchoolManager
```

### In the foreground

```bash
node packages/server/src/index.ts
```

The server prints its configuration on start-up:

```
[school] listening on http://0.0.0.0:8080
[school] database C:\school\data\school.db
[school] change cursor 4182
```

## The client

### Served by the server (recommended)

```bash
npm run build
```

The build writes `packages/web/dist`. The server serves that directory
automatically, falling back to `index.html` for unknown routes so that
client-side routing works. **One process, one port** — which is what makes the
system installable on a school laptop without any network configuration.

The client is then reachable at `http://<server-address>:8080/`.

### Served separately

Useful while developing, and possible if a school wants the client on a
different machine:

```bash
npm run dev:web     # http://localhost:5173
```

The development server proxies `/api` to `http://127.0.0.1:8080`. Point it
somewhere else with `SCHOOL_API_TARGET`.

For a separate production deployment, set `VITE_API_BASE_URL` at build time to
the server's URL and serve `packages/web/dist` from any static host.

## Installing on client devices

The client is an installable progressive web application. Open the server's
address in a browser and use the browser's "install" action. The application
then runs in its own window, keeps working with no network, and stores its
replica in the device's IndexedDB.

Clients do not need any configuration: the API URL is the origin they were
loaded from.

## First run

The database is created and migrated automatically on first start. To populate
it with a plausible school for evaluation:

```bash
npm run seed
```

The seed is idempotent: it refuses to add more data unless `--force` is
given.

## Health check

```
GET /api/v1/health
```

```json
{
  "status": "ok",
  "contractVersion": "1.0.0",
  "apiVersion": "v1",
  "node": "v24.18.0",
  "sqlite": "3.50.4",
  "cursor": 4182,
  "serverTime": "2026-10-20T08:30:00.000Z"
}
```

Use this for a service check. It touches the database only to read the change
cursor.

## Upgrading

1. Stop the service.
2. Take a backup — see [backup and restore](backup-and-restore.md).
3. `git pull` and `npm install`.
4. `npm run build`.
5. Start the service. Migrations run automatically and are recorded in
   `schema_migrations`.

Migrations are ordered and immutable. A migration that has been applied is
never edited; a correction is a new migration.
