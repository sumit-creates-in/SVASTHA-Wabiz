# SVASTHA WABIZ — single-container build (API serves the built React app)
FROM node:22-alpine AS build
WORKDIR /app

COPY server/package*.json server/
RUN npm install --prefix server
COPY client/package*.json client/
RUN npm install --prefix client

COPY server server
COPY client client
RUN npm run build --prefix server && npm run build --prefix client

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/dist ./public
EXPOSE 8080
CMD ["node", "dist/index.js"]
