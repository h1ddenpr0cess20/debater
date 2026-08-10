# Build the client, then serve dist/ from the same Node process that fronts the
# API — the path `npm start` takes, minus the .env file.

FROM node:26-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5173

# Production dependencies only. Generating a self-signed certificate pulls in a
# devDependency, so the container serves HTTP and expects TLS to be terminated
# in front of it — or a real SSL_KEY/SSL_CERT pair mounted in.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY src/server ./src/server

EXPOSE 5173
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5173)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server/index.js"]
