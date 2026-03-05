#!/bin/bash
set -e

echo "🔄 Running Prisma migrations..."
MAX_RETRIES=5
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if npx prisma migrate deploy > /dev/null 2>&1; then
    break
  fi
  echo "⚠️ Database might be restarting (init phase). Retrying in 3 seconds... ($(($MAX_RETRIES - $RETRY_COUNT)) attempts left)"
  RETRY_COUNT=$(($RETRY_COUNT + 1))
  sleep 3
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "❌ Failed to run Prisma migrations after $MAX_RETRIES attempts. Showing final error:"
  npx prisma migrate deploy
  exit 1
fi

echo "🚀 Starting Reson8 server..."
node dist/index.js &
SERVER_PID=$!

# Give the server a moment to boot and create the server record
sleep 3

echo "🌱 Running database seed..."
npx tsx prisma/seed.ts || echo "⚠️ Seed skipped (may already exist)"

# Wait for the server process
wait $SERVER_PID
