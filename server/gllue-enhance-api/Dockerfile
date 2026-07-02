FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

ENV PORT=3000
ENV DATA_DIR=/data
EXPOSE 3000

CMD ["npm", "start"]
