#!/bin/bash
set -e

echo "Running Minutia migrations..."

for f in /migrations/*.sql; do
  echo "  Applying $(basename "$f")..."
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
done

echo "All migrations applied."
