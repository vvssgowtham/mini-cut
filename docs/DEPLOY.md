# Deploying

Two pieces, deployed separately: a static front end and a small API. They are split because only
the API holds a secret, and only the front end needs the cross-origin isolation headers.

Deploy the API first — the front end needs its URL.

## 1. The API

`apps/server/Dockerfile` builds an image for Cloud Run, Fly, Render or any container host. It is
built from the repository root, not from `apps/server`, because the install needs the workspace
lockfile:

```bash
docker build -f apps/server/Dockerfile -t mini-cut-api .
docker run -p 8080:8080 -e GROQ_API_KEY=gsk_... mini-cut-api
curl localhost:8080/api/health     # {"status":"ok"}
```

### Variables

| Variable                                                | Needed                                     | Purpose                                                                                           |
| ------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` / `GROQ_API_KEY` | one of them                                | The agent, tried in that order                                                                    |
| `ALLOWED_ORIGIN`                                        | yes, when the front end is on another host | The exact front-end origin, e.g. `https://mini-cut.vercel.app`. Comma-separated for more than one |
| `GEMINI_MODEL` / `GROQ_MODEL`                           | no                                         | Override a model that has been retired or is busy                                                 |
| `PORT`                                                  | no                                         | Supplied by most hosts; defaults to 3001                                                          |

Without any key the app still runs and the agent returns 503 saying it is not configured, rather
than pretending to work. Without `ALLOWED_ORIGIN`, CORS is not registered at all — correct for a
single-origin deployment, and the reason a split deployment must set it.

## 2. The front end

`vercel.json` at the repository root is ready: it builds the whole workspace, publishes
`apps/web/dist`, and sets the two headers below. Import the repository on Vercel and accept the
detected settings.

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

## 3. Afterwards

- `GET /api/health` on the API returns `{"status":"ok"}`.
- The editor loads, and the agent box answers rather than reporting it cannot reach the service.
- Export produces a file that plays elsewhere.

If the agent says it cannot reach the editing service, the usual cause is `VITE_API_BASE_URL`
missing at build time, or `ALLOWED_ORIGIN` not matching the front end's origin exactly — scheme and
all.
