#!/usr/bin/env bash
set -euo pipefail

echo "Stopping existing Giberrator containers..."
docker compose down

echo "Rebuilding Giberrator image without cache..."
docker compose build --no-cache giberrator

echo "Registering Discord slash commands..."
docker compose run --rm giberrator npm run register

echo "Starting Giberrator..."
docker compose up -d

echo "Giberrator deployed. View logs with: docker compose logs -f giberrator"
