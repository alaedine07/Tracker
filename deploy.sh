#!/bin/bash
set -e

APP_DIR="$HOME/Tracker"

echo "==> Pulling latest code..."
cd "$APP_DIR"
git pull origin main

echo "==> Running database migrations..."
docker compose -f docker-compose.prod.yml run --rm server sh -c "npx drizzle-kit migrate"

echo "==> Building and starting services..."
docker compose -f docker-compose.prod.yml up -d --build

echo "==> Cleaning up old images..."
docker image prune -f

echo "==> Done! Checking health..."
sleep 5
curl -sf https://tracker.alaspace.me/health && echo " ✓ Server is healthy" || echo " ✗ Health check failed — check logs with: docker compose -f docker-compose.prod.yml logs server"
curl -sf https://alaspace.me/health && echo " ✓ Server is healthy" || echo " ✗ Health check failed — check logs with: docker compose -f docker-compose.prod.yml logs server"
