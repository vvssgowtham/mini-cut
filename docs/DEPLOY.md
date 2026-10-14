# Deploying

Two pieces: a static front end and a small API. They are separate because only the API needs a
secret, and only the front end needs the cross-origin isolation headers.

## Front end

Any static host works, with one hard requirement:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without both, the browser withholds `SharedArrayBuffer`, multi-threaded ffmpeg.wasm will not run,
and **export silently becomes unavailable** — the button disables itself and says why. Everything
else keeps working, which makes this an easy failure to miss.

`apps/web/vercel.json` sets them for Vercel. For another host, set the same two headers on every
response, and check them with:

```bash
curl -sI https://<your-host>/ | grep -i cross-origin
```

Note the interaction with the service worker: a navigation served from the cache carries the
headers it was precached with, so after a hosting change an offline load and an online load can
disagree about whether export works. Check both.

## API

`apps/server/Dockerfile` builds an image suitable for Cloud Run, Fly, Render or any container host.

```bash
docker build -f apps/server/Dockerfile -t mini-cut-api .
docker run -p 8080:8080 -e ANTHROPIC_API_KEY=sk-ant-... mini-cut-api
```

`ANTHROPIC_API_KEY` is the only required variable. Without it the app still runs: the agent endpoint
returns 503 and says it is not configured, rather than pretending to work.

## Routing `/api`

In development Vite proxies `/api` to `localhost:3001`. In production the front end calls `/api`
relative to its own origin, so the host must forward it to the API — a Vercel rewrite, or a load
balancer path rule. The alternative is pointing the client at an absolute API URL and enabling CORS,
which is more moving parts for no benefit.
