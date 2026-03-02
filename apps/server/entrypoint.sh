#!/bin/bash
set -e

echo "🔄 Running Prisma migrations..."
npx prisma migrate deploy

echo "🚀 Starting Reson8 server..."
node dist/index.js &
SERVER_PID=$!

# Give the server a moment to boot and create the server record
sleep 3

echo "🌱 Running database seed..."
npx tsx prisma/seed.ts || echo "⚠️ Seed skipped (may already exist)"

# Wait for the server process
wait $SERVER_PID
