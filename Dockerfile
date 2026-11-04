FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend ./backend
COPY frontend ./frontend
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app ./
RUN mkdir -p /app/backend/data/sessions && chown -R node:node /app/backend/data
USER node
EXPOSE 3000
CMD ["npm", "start"]
