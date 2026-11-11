FROM node:24-alpine
WORKDIR /app
COPY package.json server.js llm.js stockfish.js solve.js record-search.js arrangements.js accounts.js ratings.js tournaments.js ./
COPY public/ ./public/
ENV DATA_DIR=/app/data
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node","server.js"]



