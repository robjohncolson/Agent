FROM caddy:2-alpine
COPY . /srv
RUN printf ':8080 {\n\troot * /srv\n\tfile_server\n\ttry_files {path} /index.html\n\theader {\n\t\tX-Content-Type-Options nosniff\n\t\tX-Frame-Options DENY\n\t}\n}\n' > /etc/caddy/Caddyfile
EXPOSE 8080
