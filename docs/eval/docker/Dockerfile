# Build the pinned source as a distributable package; keep installation in the timed trial.
ARG BASE_IMAGE=node:24.14.0-bookworm
FROM ${BASE_IMAGE} AS package
WORKDIR /build
COPY devkit/package*.json ./
RUN npm ci --ignore-scripts
COPY devkit/ ./
RUN npm run build && node scripts/check-package.mjs && npm pack --ignore-scripts --pack-destination /tmp

FROM ${BASE_IMAGE}
ARG GROK_VERSION=1.0.25
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git openssh-client python3 ripgrep time procps \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://x.ai/cli/install.sh -o /tmp/install-grok.sh \
    && HOME=/opt/grok bash /tmp/install-grok.sh "${GROK_VERSION}" \
    && rm /tmp/install-grok.sh
COPY --from=package /tmp/fx-devkit-*.tgz /opt/eval/fx.tgz
RUN mkdir -p /state /evidence && chown node:node /state /evidence
ENV PATH="/opt/grok/.grok/bin:${PATH}"
USER node
WORKDIR /state
CMD ["sleep", "infinity"]
