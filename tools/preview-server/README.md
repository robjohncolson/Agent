# preview-server

Dependency-free Node static file server that replaces the ad-hoc
`python3 -m http.server` processes that used to be started by hand for each
repo (and then orphaned). One canonical port, one config file, one systemd
user unit.

## Canonical port: 8123

Chosen to match the default in casio-sxc1's `scripts/serve-site.sh`, so
existing bookmarks keep working. Binds `127.0.0.1` only — never reachable
from the network. Override with the `PREVIEW_PORT` env var if needed.

## URLs

- `http://127.0.0.1:8123/` — index page listing all mounts
- `http://127.0.0.1:8123/casio/` — casio-sxc1 site
- `http://127.0.0.1:8123/japan/` — japan-2026, etc.

## Configuration

`mounts.json` maps URL prefixes to directories:

```json
{ "/casio": "/home/mrcolson/repos/casio-sxc1/site/public" }
```

Mounts whose directory does not exist are skipped at startup with a warning
(deleting a repo never takes the server down). After editing mounts.json:

    systemctl --user restart repo-preview.service

## Service

The unit lives in this directory (`repo-preview.service`) and is installed as
a systemd *user* unit — no sudo involved:

    cp repo-preview.service ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable --now repo-preview.service

Logs: `journalctl --user -u repo-preview.service`.

Linger is enabled for mrcolson (`loginctl enable-linger mrcolson`), so the
service starts at boot without waiting for a login.

## Behavior notes

- Directory requests serve `index.html`; a missing trailing slash 301s so
  relative links resolve.
- `.wasm` is served as `application/wasm` — required for
  `WebAssembly.instantiateStreaming` (casio-sxc1 and japan-2026 both ship
  WASM).
- Path traversal is rejected in two layers: the WHATWG URL parser collapses
  raw `..` segments before mount matching (404), and a resolve-then-contain
  check catches encoded forms like `..%2f` (403). Verified with
  `curl --path-as-is`.
- GET/HEAD only; anything else is 405.
