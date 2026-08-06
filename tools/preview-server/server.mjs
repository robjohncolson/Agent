// Dependency-free static file server for local repo previews.
//
// Replaces the ad-hoc `python3 -m http.server` processes that used to be
// started by hand (and then orphaned) whenever a repo needed previewing.
// One canonical port, one config file, one systemd user unit.
//
// Port 8123 was chosen because casio-sxc1's scripts/serve-site.sh already
// defaults to it, so bookmarks and muscle memory carry over.
//
// Config: mounts.json next to this file maps URL prefixes to directories.
// Missing directories are skipped at startup with a warning, not fatal, so
// deleting a repo never takes the whole preview server down.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PREVIEW_PORT) || 8123;

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.argv[2] || path.join(here, 'mounts.json');

// ---------------------------------------------------------------------------
// Load and validate mounts
// ---------------------------------------------------------------------------
const rawMounts = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const mounts = []; // [{ prefix, root }] sorted longest-prefix-first

for (const [prefix, dir] of Object.entries(rawMounts)) {
  if (!prefix.startsWith('/') || prefix === '/') {
    console.warn(`skipping invalid prefix ${JSON.stringify(prefix)} (must start with "/", must not be "/")`);
    continue;
  }
  let root;
  try {
    // realpath pins the root so a symlinked mount dir still gets a stable
    // base for the containment check below.
    root = fs.realpathSync(dir);
  } catch {
    console.warn(`skipping mount ${prefix}: directory not found: ${dir}`);
    continue;
  }
  if (!fs.statSync(root).isDirectory()) {
    console.warn(`skipping mount ${prefix}: not a directory: ${dir}`);
    continue;
  }
  mounts.push({ prefix: prefix.replace(/\/+$/, ''), root });
}
mounts.sort((a, b) => b.prefix.length - a.prefix.length);

if (mounts.length === 0) {
  console.error(`no usable mounts in ${configPath}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------
// .wasm MUST be application/wasm or WebAssembly.instantiateStreaming fails
// (casio-sxc1 and japan-2026 both ship WASM).
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.map': 'application/json',
  '.ics': 'text/calendar',
};

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------
function fail(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`${code} ${msg}\n`);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function indexPage() {
  const rows = mounts
    .slice()
    .sort((a, b) => a.prefix.localeCompare(b.prefix))
    .map(
      (m) =>
        `<li><a href="${m.prefix}/">${escapeHtml(m.prefix)}/</a>` +
        ` <code>${escapeHtml(m.root)}</code></li>`
    )
    .join('\n');
  return `<!doctype html>
<meta charset="utf-8">
<title>repo previews</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 48rem; margin: 3rem auto; padding: 0 1rem; }
  code { background: rgba(128,128,128,.15); padding: .1em .35em; border-radius: 4px; font-size: .85em; }
  li { margin: .4em 0; }
</style>
<h1>repo previews</h1>
<p>Served by <code>Agent/tools/preview-server</code> on ${HOST}:${PORT}.</p>
<ul>
${rows}
</ul>
`;
}

function serveFile(req, res, filePath) {
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const size = fs.statSync(filePath).size;
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return fail(res, 405, 'Method Not Allowed');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
  } catch {
    return fail(res, 400, 'Bad Request');
  }
  if (pathname.includes('\0')) {
    return fail(res, 400, 'Bad Request');
  }

  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(indexPage());
  }

  const mount = mounts.find(
    (m) => pathname === m.prefix || pathname.startsWith(m.prefix + '/')
  );
  if (!mount) {
    return fail(res, 404, 'Not Found (no such mount — see / for the list)');
  }

  // Containment check: resolve the remainder against the mount root and
  // require the result to stay inside it. This is what stops
  // /casio/../../../etc/passwd — after path.resolve the ".." segments are
  // collapsed and the result no longer starts with the root.
  const rest = pathname.slice(mount.prefix.length);
  const resolved = path.resolve(mount.root, '.' + rest);
  if (resolved !== mount.root && !resolved.startsWith(mount.root + path.sep)) {
    return fail(res, 403, 'Forbidden (path escapes mount root)');
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return fail(res, 404, 'Not Found');
  }

  if (stat.isDirectory()) {
    // Redirect dir requests missing the trailing slash so relative URLs in
    // the served index.html resolve correctly.
    if (!pathname.endsWith('/')) {
      res.writeHead(301, { Location: encodeURI(pathname) + '/' });
      return res.end();
    }
    const index = path.join(resolved, 'index.html');
    if (!fs.existsSync(index)) {
      return fail(res, 404, 'Not Found (no index.html in directory)');
    }
    return serveFile(req, res, index);
  }

  if (!stat.isFile()) {
    return fail(res, 404, 'Not Found');
  }
  serveFile(req, res, resolved);
});

server.listen(PORT, HOST, () => {
  console.log(`preview-server listening on http://${HOST}:${PORT}/`);
  for (const m of mounts) {
    console.log(`  ${m.prefix}/ -> ${m.root}`);
  }
});
