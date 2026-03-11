FROM caddy:2-alpine

COPY . /srv

# Caddyfile: serve static files with SPA fallback
RUN printf ':8080 {\n\troot * /srv\n\tfile_server\n\ttry_files {path} /index.html\n\theader {\n\t\tX-Content-Type-Options nosniff\n\t\tX-Frame-Options DENY\n\t}\n}\n' > /etc/caddy/Caddyfile

# Entrypoint script: inject env vars into index.html at container start
RUN printf '#!/bin/sh\nset -e\nif [ -n "$SUPABASE_ANON_KEY" ]; then\n  sed -i "s|REPLACE_WITH_ANON_KEY|$SUPABASE_ANON_KEY|g" /srv/index.html\nfi\nif [ -n "$SUPABASE_URL" ]; then\n  sed -i "s|https://hgvnytaqmuybzbotosyj.supabase.co|$SUPABASE_URL|g" /srv/index.html\nfi\nexec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile\n' > /srv/entrypoint.sh && chmod +x /srv/entrypoint.sh

EXPOSE 8080
CMD ["/srv/entrypoint.sh"]
