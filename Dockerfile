# The whole app in one image: the built frontend and the server that serves it
# (single origin). Built by Fly.io from `npm run deploy:fly`; any container
# host can run it. The server listens on $PORT.

# ---------- 1. Build the frontend ----------
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error

COPY index.html vite.config.js ./
COPY public public
COPY shared shared
COPY src src

# There's no git checkout in here: the version is passed in (shared/version.js)
ARG MANHUNT_BUILD
ARG MANHUNT_COMMIT
ARG MANHUNT_COMMIT_DATE
ENV MANHUNT_BUILD=$MANHUNT_BUILD \
    MANHUNT_COMMIT=$MANHUNT_COMMIT \
    MANHUNT_COMMIT_DATE=$MANHUNT_COMMIT_DATE

# Single origin: the frontend talks to the server it was loaded from
RUN VITE_API_ORIGIN= npx vite build

# ---------- 2. The server, with the built frontend ----------
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

COPY server/package.json server/package-lock.json server/
RUN npm --prefix server ci --omit=dev --no-audit --no-fund --loglevel=error

# package.json is what makes shared/ ES modules, which the server loads
COPY package.json ./
COPY shared shared
COPY server server
COPY --from=build /app/dist dist

# The same version the frontend was built with, so the two agree
ARG MANHUNT_BUILD
ARG MANHUNT_COMMIT
ARG MANHUNT_COMMIT_DATE
ENV MANHUNT_BUILD=$MANHUNT_BUILD \
    MANHUNT_COMMIT=$MANHUNT_COMMIT \
    MANHUNT_COMMIT_DATE=$MANHUNT_COMMIT_DATE

USER node
EXPOSE 8080
CMD ["node", "server/server.js"]
