#!/bin/sh
set -e

echo "Running database migrations..."
node_modules/.bin/drizzle-kit migrate

echo "Starting API server..."
exec node dist/index.js
