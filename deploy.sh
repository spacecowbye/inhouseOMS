#!/bin/bash
set -e

echo "🚀 Starting deployment..."

echo "📥 Pulling latest code..."
git pull origin main

echo "📦 Building and starting containers..."
# Docker automatically invalidates the npm layer when package.json changes
docker compose up --build -d --remove-orphans

echo "🧹 Cleaning up old Docker images..."
docker image prune -f

echo "✅ Deployment completed successfully!"