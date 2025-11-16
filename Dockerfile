# Stage 1: Build the React Application
FROM node:20-alpine as builder
WORKDIR /app

# Ensure you use the environment variable during the build
# VITE_API_BASE_URL is passed via docker-compose.yml (args section)
COPY package.json package-lock.json vite.config.js ./
RUN npm install
COPY . .
# 'npm run build' generates the static assets in the 'dist' folder
RUN npm run build 

# Stage 2: Serve the application with Nginx
FROM nginx:alpine
# Copy the built files from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html
# Remove default Nginx config and copy custom config (for proxying)
RUN rm /etc/nginx/conf.d/default.conf
COPY ./nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]