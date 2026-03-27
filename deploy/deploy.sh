#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# Uniq.chat — VPS Deployment Script
# Run on the server as root or sudo user
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

APP_DIR="/opt/uniqchat"
DOMAIN="uniq.chat"

echo "▶ Uniq.chat deploy starting..."

# ── 1. Dependencies ────────────────────────────────────────────────────────────
echo "▶ Installing dependencies..."
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-plugin nginx certbot python3-certbot-nginx curl git

systemctl enable --now docker
systemctl enable --now nginx

# ── 2. Clone / pull repo ──────────────────────────────────────────────────────
echo "▶ Setting up app directory..."
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR" && git pull
else
  git clone https://github.com/your-org/uniqchat "$APP_DIR"
fi
cd "$APP_DIR"

# ── 3. Environment file ───────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "▶ Creating .env from example..."
  cp .env.example .env
  echo ""
  echo "⚠️  Edit .env with your secrets before continuing:"
  echo "     nano $APP_DIR/.env"
  echo "   Then re-run this script."
  exit 0
fi

# ── 4. Nginx config ───────────────────────────────────────────────────────────
echo "▶ Configuring Nginx..."
cp deploy/nginx.conf /etc/nginx/sites-available/uniqchat
ln -sf /etc/nginx/sites-available/uniqchat /etc/nginx/sites-enabled/uniqchat
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ── 5. SSL — Let's Encrypt ────────────────────────────────────────────────────
echo "▶ Requesting SSL certificates..."
certbot --nginx \
  -d "$DOMAIN" \
  -d "www.$DOMAIN" \
  -d "api.$DOMAIN" \
  -d "media.$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --email "admin@$DOMAIN" \
  --redirect

systemctl reload nginx

# ── 6. Build & start containers ───────────────────────────────────────────────
echo "▶ Building and starting Docker containers..."
docker compose pull --quiet 2>/dev/null || true
docker compose build --no-cache
docker compose up -d

echo ""
echo "✅ Uniq.chat is live!"
echo "   Frontend: https://$DOMAIN"
echo "   API:      https://api.$DOMAIN"
echo "   Media:    https://media.$DOMAIN"
echo ""
echo "   Logs:     docker compose logs -f"
echo "   Status:   docker compose ps"
