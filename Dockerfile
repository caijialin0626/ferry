FROM node:24-bookworm-slim
WORKDIR /app
RUN install -d -o node -g node -m 0700 /var/lib/ferry
ENV FERRY_WEB_DATA=/var/lib/ferry
COPY --chown=node:node src/ ./src/
COPY --chown=node:node public/ ./public/
USER node
CMD ["node", "src/web.mjs"]
