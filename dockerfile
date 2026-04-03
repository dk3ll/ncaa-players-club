FROM oven/bun:slim AS builder

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock tsconfig.json ./
RUN bun install --production --no-cache

COPY src src

RUN bun build \
  --compile \
  --minify-whitespace \
  --minify-syntax \
  --target bun \
  --outfile server \
  ./src/index.ts

# ? -------------------------

FROM gcr.io/distroless/base:nonroot

COPY --from=builder /app/server .
COPY --from=builder /app/src/dashboard/index.html ./src/dashboard/index.html
COPY --from=builder /app/src/betadraft/index.html ./src/betadraft/index.html
COPY --from=builder /app/src/admin/index.html ./src/admin/index.html
COPY --from=builder /app/src/admin/dashboard.html ./src/admin/dashboard.html

CMD ["./server"]

EXPOSE 3000
