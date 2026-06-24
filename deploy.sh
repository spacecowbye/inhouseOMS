#!/bin/bash
echo "🚀 Starting deployment..."
git pull
echo "🧹 Stopping containers..."
docker compose down
echo "📦 Building and starting containers..."
docker compose up --build -d
echo "✅ Deployment completed successfully!"
