# Stage 1: Build the React Application
FROM node:20-alpine as builder
WORKDIR /app
COPY package.json package-lock.json vite.config.js ./
RUN npm install
COPY . .
# Run the build command defined in your package.json
RUN npm run build 

# Stage 2: Serve the application with Nginx
FROM nginx:alpine
# Copy the built files from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Set the URL as an environment variable that can be passed at runtime
ENV API_URL=http://api:3001

# Remove default Nginx config and copy custom config (for proxying)
RUN rm /etc/nginx/conf.d/default.conf
COPY ./nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]