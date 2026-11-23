FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    BASE_PATH=/dig \
    DATA_DIR=/app/data
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY client ./client
RUN mkdir -p /app/data && chown -R node:node /app
USER node
# Saved ships live here. Mount a volume or they vanish when the container is replaced.
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/index.js"]
