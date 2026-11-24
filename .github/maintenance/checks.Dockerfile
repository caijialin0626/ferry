FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --prefix /opt/ferry-checks --ignore-scripts playwright-core@1.56.1
WORKDIR /work
