FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* && test -s /etc/ssl/certs/ca-certificates.crt
RUN npm install --global --ignore-scripts @openai/codex@0.148.0 && codex --version
ENTRYPOINT ["codex"]
