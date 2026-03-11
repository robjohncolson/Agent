FROM caddy:2-alpine

COPY . /srv

# Inject Supabase config at build time (Railway exposes env vars as build args)
ARG SUPABASE_ANON_KEY=REPLACE_WITH_ANON_KEY
ARG SUPABASE_URL=https://hgvnytaqmuybzbotosyj.supabase.co
RUN sed -i "s|REPLACE_WITH_ANON_KEY|${SUPABASE_ANON_KEY}|g" /srv/index.html \
 && sed -i "s|https://hgvnytaqmuybzbotosyj.supabase.co|${SUPABASE_URL}|g" /srv/index.html

# Caddyfile: serve static files with SPA fallback
RUN printf ':8080 {\n\troot * /srv\n\tfile_server\n\ttry_files {path} /index.html\n\theader {\n\t\tX-Content-Type-Options nosniff\n\t\tX-Frame-Options DENY\n\t}\n}\n' > /etc/caddy/Caddyfile

EXPOSE 8080
