# Deploying

Two pieces, deployed separately: a static front end and a small API. They are split because only
the API holds a secret, and only the front end needs the cross-origin isolation headers.

Deploy the API first — the front end needs its URL.

## 1. The API

`Dockerfile` at the repository root builds the API, for Cloud Run, Fly, Render or any container
host. It sits at the root because the install needs the workspace lockfile, and because hosts
default the build context to wherever the Dockerfile lives — one in `apps/server` would copy
nothing and fail on its first line.

```bash
docker build -t mini-cut-api .
docker run -p 8080:8080 -e GROQ_API_KEY=gsk_... mini-cut-api
curl localhost:8080/api/health     # {"status":"ok"}
```

On Render: Runtime **Docker**, Dockerfile path `./Dockerfile`, and leave the build context at the
repository root.

### Variables

| Variable                                                | Needed                                     | Purpose                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` / `GROQ_API_KEY` | one of them                                | The agent, tried in that order                                                                                                                     |
| `ALLOWED_ORIGIN`                                        | yes, when the front end is on another host | Every front-end origin, exactly as the browser sends it, comma-separated: `https://minicardboard.vvssgowtham.in,https://mini-cut-theta.vercel.app` |
| `GEMINI_MODEL` / `GROQ_MODEL`                           | no                                         | Override a model that has been retired or is busy                                                                                                  |
| `PORT`                                                  | no                                         | Supplied by most hosts; defaults to 3001                                                                                                           |

Without any key the app still runs and the agent returns 503 saying it is not configured, rather
than pretending to work. Without `ALLOWED_ORIGIN`, CORS is not registered at all — correct for a
single-origin deployment, and the reason a split deployment must set it.

## 2. The front end

Vercel detects both workspaces and offers to group them as **Services**. Do not take that offer:
the API is a long-running server that calls `listen()`, and Vercel would run it as a function. Use
**Import single project** on `web` alone, and deploy the API as a container (step 1).

Either root works — there is a `vercel.json` for each, so the headers are set whichever Vercel
picks:

| Root Directory | Config used            | Notes                                             |
| -------------- | ---------------------- | ------------------------------------------------- |
| `apps/web`     | `apps/web/vercel.json` | What "Import single project" on `web` gives you   |
| `./`           | `vercel.json`          | Set the Application Preset to Other, not Services |

Both install and build from the repository root, because the web app depends on the `shared`
workspace and a build confined to `apps/web` cannot resolve it.

Set one build-time variable:

```
VITE_API_BASE_URL = https://<your-api-host>
```

It is baked in at build time, so changing it needs a redeploy. Leave it unset only if something is
rewriting `/api` to the API on the same origin.

### The headers that matter

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without both, the browser withholds `SharedArrayBuffer`, multi-threaded ffmpeg.wasm cannot run, and
**export quietly becomes unavailable** — the button disables itself and explains why, while
everything else keeps working. That makes it easy to miss. Check after deploying:

```bash
curl -sI https://<your-host>/ | grep -i cross-origin
```

One wrinkle: a navigation served from the service worker cache carries the headers it was precached
with, so after a hosting change an offline load and an online load can disagree about whether export
works. Check both.

## Cold starts on a free tier

A free container sleeps after a quarter of an hour idle and takes the better part of a minute to
wake. For a link someone clicks once, that first minute is the whole impression — so the agent panel
says what is happening after four seconds rather than sitting on "Thinking".

To avoid it entirely, keep the service warm by pinging `/api/health` every ten minutes or so. It
returns a fixed object, touches no model and spends no tokens, which is exactly what makes it the
right target:

- **cron-job.org** — free, intervals down to a minute, no card.
- **UptimeRobot** — free, five-minute intervals, and tells you when the service is down.
- **Better Stack** — same idea, nicer reports.

Worth knowing before relying on it: a free Render instance has a monthly hour budget, and staying
awake all month uses nearly all of it. One service fits; two do not.

The alternative is a host that does not have this problem. Cloud Run scales to zero and cold-starts
in a second or two rather than a minute, and its free tier is generous — no pinging, no budget to
watch. If the demo link matters, it is the better answer than keeping a sleepy instance awake.

## 3. Afterwards

- `GET /api/health` on the API returns `{"status":"ok"}`.
- The editor loads, and the agent box answers rather than reporting it cannot reach the service.
- Export produces a file that plays elsewhere.

If the agent says it cannot reach the editing service, the usual cause is `VITE_API_BASE_URL`
missing at build time, or `ALLOWED_ORIGIN` not matching the front end's origin exactly — scheme and
all.

A custom domain is a second origin, not a rename: adding one in Vercel does not retire the
`*.vercel.app` one, and the API will keep refusing the new name until it is in `ALLOWED_ORIGIN`
too. The symptom is narrow — the editor loads, imports, plays and exports, and only the agent
fails — because CORS is the one thing in this app that needs the server's permission. Check it
without a browser:

```bash
curl -si -X OPTIONS https://<api-host>/api/agent \
  -H 'Origin: https://<front-end-origin>' \
  -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin
```

No header back means the origin is not on the list.
