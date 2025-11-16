FROM node:20-alpine
WORKDIR /usr/src/app

# Install dependencies (@aws-sdk/client-s3, multer, express, etc.)
COPY server/package*.json ./
RUN npm install

# Copy server code and ensure the SQLite DB file can be created here
COPY server/ .

# Expose the internal port 3001
EXPOSE 3001

CMD ["node", "server.js"]