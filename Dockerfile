# Chanlyst, self-hosted.
#
# The application runs on the Cloudflare Workers runtime through wrangler, and
# its database is a SQLite file that runtime manages. That is unusual enough
# that "clone it and figure it out" would lose most readers on the first
# evening, which is what this image exists to prevent.
#
# One image, one volume, one required key.

FROM node:22-slim

# wrangler downloads its runtime on first start; doing it at build time means a
# container starts in seconds rather than minutes, and works offline after.
ENV npm_config_update_notifier=false
WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# State lives here: the SQLite database and wrangler's own files. Mount it, or
# every restart is a fresh install with no products and no channels.
VOLUME ["/app/.wrangler"]

EXPOSE 3000
CMD ["sh", "deploy/docker-start.sh"]
