FROM node:24.17.0-bookworm-slim

ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1 \
    EXPO_NO_TELEMETRY=1

RUN npm install --global pnpm@10.34.0

WORKDIR /workspace

CMD ["node", "--version"]
