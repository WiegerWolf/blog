FROM oven/bun:1.3.8

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY scripts ./scripts

CMD ["bun", "run", "tg:bot"]
