# Deploying the client mini app at https://dchr.koinotinav.com/ats/

`dchr.koinotinav.com` is already used by another project (the recruitment platform,
`~/Rust-Screenx-HR-Automatization`). Its **Caddy** container (`recruitment-caddy`)
is the edge on `:80` for that domain — TLS is terminated upstream by a managed
OpenResty that forwards plain HTTP here. So the mini app is **co-hosted under the
`/ats/` subpath** of that same Caddy; we do NOT run our own proxy or take the domain.

Layout (same origin → no CORS):

| URL                                      | Goes to                                  |
|------------------------------------------|------------------------------------------|
| `https://dchr.koinotinav.com/ats/`       | mini app build (`miniapp` container :5174) |
| `https://dchr.koinotinav.com/ats/api/*`  | AtS FastAPI (`api` container :8000)        |
| everything else                          | recruitment frontend (unchanged)          |

`recruitment-caddy` reaches our containers over the Docker host gateway
(`172.20.0.1`), since `api` publishes `:8000` and `miniapp` publishes `:5174`.

## 1. AtS side (this repo, on the server)

In `.env`:

```
MINIAPP_URL=https://dchr.koinotinav.com/ats/
MINIAPP_API_BASE_URL=https://dchr.koinotinav.com/ats/api
```

Then:

```
docker compose up -d miniapp bot
```

`miniapp` builds with `MINIAPP_API_BASE_URL` baked in (relative `base: "./"`, so the
bundle works under `/ats/`) and serves it via `vite preview` on `:5174`. `bot` is
recreated so its menu/inline button opens `MINIAPP_URL`.

## 2. Recruitment Caddy (the edge — a different project)

Add these blocks inside the existing `:80 { … }` site in
`~/Rust-Screenx-HR-Automatization/Caddyfile`, **before** the recruitment catch-all,
and wrap that catch-all in `handle {}` (all terminal handlers must be inside
`handle` blocks — mixing a bare `redir`/`reverse_proxy` with `handle` blocks
scrambles routing):

```caddy
    # --- AtS booking mini app — co-hosted under /ats/ ---
    handle_path /ats/api/* {
        reverse_proxy 172.20.0.1:8000 {
            header_up X-Forwarded-Proto https
        }
    }
    @ats_bare path /ats
    handle @ats_bare {
        redir * /ats/ 308
    }
    handle_path /ats/* {
        reverse_proxy 172.20.0.1:5174
    }
    # --- end AtS ---

    handle {
        reverse_proxy frontend:3000 {
            header_up X-Forwarded-Proto https
        }
    }
```

Apply (back up first; `caddy validate` before, and prefer a container restart —
the graceful `caddy reload` did not reliably pick up the change in testing):

```
cd ~/Rust-Screenx-HR-Automatization
cp Caddyfile Caddyfile.bak.$(date +%s)
docker exec recruitment-caddy caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
docker restart recruitment-caddy
```

## 3. Verify

```
H='Host: dchr.koinotinav.com'
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" http://127.0.0.1/           # 200 recruitment
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" http://127.0.0.1/ats/        # 200 mini app
curl -s -o /dev/null -w '%{http_code}\n' -H "$H" http://127.0.0.1/ats/api/docs # 200
# /ats/api/client/bootstrap -> 401 "missing init data" (needs Telegram initData)
```

Note: the bot token is shared between dev and prod `.env`. Only ONE bot may poll a
token at a time — stop any local/dev `bot` container or you'll get
`TelegramConflictError` on the server.
