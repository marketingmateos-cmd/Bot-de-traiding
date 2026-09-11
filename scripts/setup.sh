#!/usr/bin/env bash
# One-command local setup: creates .env, starts Postgres if it's available
# locally, creates the database, pushes the Prisma schema, and seeds demo
# data. Safe to re-run — every step is idempotent.
set -e

cd "$(dirname "$0")/.."

echo "== Crypto AI Trading Lab — setup =="

# 1. .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "-> Creado .env a partir de .env.example"
else
  echo "-> .env ya existe, no lo toco"
fi

DB_URL=$(grep -E '^DATABASE_URL=' .env | sed -E 's/^DATABASE_URL="?//; s/"?$//')
DB_NAME=$(echo "$DB_URL" | sed -E 's#.*/([^/?]+).*#\1#')

# 2. Try to start a local Postgres if one is installed (Debian/Ubuntu style).
if command -v pg_lsclusters >/dev/null 2>&1; then
  if ! pg_lsclusters 2>/dev/null | grep -q "online"; then
    echo "-> Iniciando PostgreSQL local..."
    sudo service postgresql start || service postgresql start || true
    sleep 2
  fi
  # Make sure the postgres role has the password used in .env.example.
  sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';" >/dev/null 2>&1 || true
fi

# 3. Create the database if it doesn't exist yet.
if command -v psql >/dev/null 2>&1; then
  PGPASSWORD=postgres psql -h localhost -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" 2>/dev/null | grep -q 1 \
    || PGPASSWORD=postgres createdb -h localhost -U postgres "$DB_NAME" 2>/dev/null \
    || echo "-> No se pudo crear la base de datos automáticamente. Si usas una base de datos externa (Neon, Supabase, Railway...) simplemente pon su URL en DATABASE_URL dentro de .env y vuelve a ejecutar este script."
fi

# 4. Prisma schema + seed.
echo "-> Sincronizando el esquema de la base de datos..."
npx prisma db push

echo "-> Sembrando datos de ejemplo (activos, estrategias, cuenta paper)..."
npx tsx prisma/seed.ts

echo ""
echo "✅ Todo listo. Ahora ejecuta:"
echo ""
echo "   npm run dev"
echo ""
echo "y abre http://localhost:3000 (o la URL pública que te dé tu entorno, p.ej. Codespaces)."
