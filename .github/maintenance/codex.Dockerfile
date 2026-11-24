FROM node:24-bookworm-slim
RUN npm install --global --ignore-scripts @openai/codex@0.148.0 && codex --version
ENTRYPOINT ["codex"]
