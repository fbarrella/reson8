#!/bin/bash
set -e

echo "🔄 Running Prisma migrations..."
npx prisma migrate deploy

echo "🌱 Running database seed..."
npx tsx prisma/seed.ts || echo "⚠️ Seed skipped (may already exist)"

echo "🚀 Starting Reson8 server..."
exec node dist/index.js
