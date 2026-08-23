FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY . .

RUN mkdir -p data backend/data

ENV VENDOR_LICENSE_PORT=3005
ENV HOST=0.0.0.0

EXPOSE 3005

VOLUME ["/app/data", "/app/backend/data"]

CMD ["node", "backend/server.mjs"]
