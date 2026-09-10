# Build only approved user documentation; the runtime contains static assets only.
FROM node:24.14.0-bookworm-slim AS build
WORKDIR /site
COPY docs/website/package*.json docs/website/
RUN npm --prefix docs/website ci
COPY package.json LICENSE CHANGELOG.md ./
COPY docs/ docs/
COPY skills/ skills/
COPY src/domain/distribution.js src/domain/
ENV FX_DISTRIBUTION=internal
ARG SITE_BASE_PATH=/
ARG SITE_ORIGIN
ARG SITE_REPOSITORY_URL
RUN test "$SITE_BASE_PATH" = / && SITE_BASE_PATH="$SITE_BASE_PATH" SITE_ORIGIN="$SITE_ORIGIN" SITE_REPOSITORY_URL="$SITE_REPOSITORY_URL" \
    npm --prefix docs/website run build && npm --prefix docs/website run check

FROM nginx:1.28-alpine AS website
COPY docs/website/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site/docs/website/dist/ /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
