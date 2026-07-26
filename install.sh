#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# install.sh — Bootstrap complet d'un nœud Angul.io (plan_implementation.md, Lot 8)
# ==============================================================================
# Pensé pour le Wyse 5070 (§8.2 du cahier des charges) sur Ubuntu Server fraîchement
# installé. Met en place :
#   - dépendances système + Node.js (§8.4)
#   - récupération et build du code depuis GitHub
#   - service systemd du serveur de jeu, démarré automatiquement au boot (§8.4)
#   - pare-feu ufw (SSH + HTTP/HTTPS uniquement — le port de jeu n'est jamais exposé
#     directement, tout passe par le reverse proxy)
#   - Caddy en reverse proxy avec HTTPS automatique (Let's Encrypt) sur le sous-domaine
#     DuckDNS (§8.5) — gère aussi le proxy WebSocket (upgrade géré nativement par Caddy)
#   - mise à jour périodique de l'IP DuckDNS, en filet de sécurité (§8.3)
#
# Hors périmètre de ce script (à faire manuellement — voir plan_implementation.md) :
#   - §8.1 : installation de l'OS et premier accès SSH (préalable à tout le reste).
#   - §8.2 : redirection de port (NAT/PAT) sur la box Internet vers cette machine,
#     ports 80 et 443 — impossible à configurer depuis la machine elle-même.
#   - PostgreSQL (Lot 3, comptes joueurs) : rien dans le code ne l'utilise encore à ce
#     jour, l'installer maintenant serait un service qui tourne pour rien. Ce script
#     sera étendu quand le Lot 3 démarrera.
#
# Idempotent : relancer ce script après une mise à jour du code (git push) récupère
# la dernière version, rebuild, et redémarre le service — pas seulement un run jetable.
#
# Usage :
#   1. Renseigner DUCKDNS_SUBDOMAIN et DUCKDNS_TOKEN ci-dessous (les autres valeurs par
#      défaut conviennent pour un déploiement standard).
#   2. sudo ./install.sh
# ==============================================================================

# --- Configuration à adapter --------------------------------------------------
REPO_URL="https://github.com/FantasmaGlad/Angul.io.git"
APP_DIR="/opt/angulio"
APP_USER="angulio"
GAME_PORT="8080"
NODE_MAJOR="20"

DUCKDNS_SUBDOMAIN=""                                  # ex. "angulio" -> angulio.duckdns.org — À REMPLIR
DUCKDNS_TOKEN=""                                      # jeton depuis https://www.duckdns.org — À REMPLIR
LETSENCRYPT_EMAIL="clement.barillot3901@gmail.com"    # contact ACME de Caddy, modifiable
# --------------------------------------------------------------------------------

if [[ $EUID -ne 0 ]]; then
  echo "Ce script doit être exécuté en root (sudo ./install.sh)." >&2
  exit 1
fi

if [[ -z "$DUCKDNS_SUBDOMAIN" || -z "$DUCKDNS_TOKEN" ]]; then
  echo "Renseigne DUCKDNS_SUBDOMAIN et DUCKDNS_TOKEN en haut de ce script avant de le lancer." >&2
  exit 1
fi

DOMAIN="${DUCKDNS_SUBDOMAIN}.duckdns.org"

log() { echo -e "\n>>> $1"; }

# --- 1. Dépendances système ------------------------------------------------------
log "Mise à jour du système et installation des dépendances de base"
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git ufw ca-certificates gnupg apt-transport-https

# --- 2. Node.js -------------------------------------------------------------------
CURRENT_NODE_MAJOR="$(command -v node >/dev/null && node -v | grep -oE '^v[0-9]+' | tr -d v || echo 0)"
if [[ "$CURRENT_NODE_MAJOR" -lt "$NODE_MAJOR" ]]; then
  log "Installation de Node.js ${NODE_MAJOR}.x (dépôt NodeSource)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  log "Node.js déjà présent ($(node -v)), installation ignorée"
fi

# --- 3. Caddy (reverse proxy + HTTPS automatique) ---------------------------------
if ! command -v caddy >/dev/null; then
  log "Installation de Caddy (dépôt officiel)"
  apt-get install -y debian-keyring debian-archive-keyring
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
else
  log "Caddy déjà présent, installation ignorée"
fi

# --- 4. Utilisateur système dédié (pas de home pré-rempli : évite un conflit avec
#        git clone, qui exige un répertoire cible vide ou inexistant) ---------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Création de l'utilisateur système $APP_USER"
  useradd --system --no-create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

# --- 5. Récupération et build du code ---------------------------------------------
if [[ -d "$APP_DIR/.git" ]]; then
  log "Code déjà présent dans $APP_DIR : mise à jour (git pull)"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
  log "Clonage du dépôt dans $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi

log "Installation des dépendances npm et build (shared/server/client/admin)"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci && npm run build"

# --- 6. Service systemd du serveur de jeu ------------------------------------------
log "Écriture du service systemd angulio.service"
cat > /etc/systemd/system/angulio.service <<EOF
[Unit]
Description=Angul.io - serveur de jeu
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/server
Environment=PORT=${GAME_PORT}
ExecStart=/usr/bin/node ${APP_DIR}/server/dist/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable angulio
systemctl restart angulio

# --- 7. Reverse proxy Caddy (HTTPS automatique sur le domaine DuckDNS) -------------
log "Écriture du Caddyfile pour $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
{
    email ${LETSENCRYPT_EMAIL}
}

${DOMAIN} {
    reverse_proxy localhost:${GAME_PORT}
}
EOF

systemctl enable caddy
systemctl restart caddy

# --- 8. Pare-feu (ufw) : uniquement SSH + HTTP/HTTPS -------------------------------
# Le port de jeu (GAME_PORT) n'est volontairement pas ouvert : le serveur Node
# n'est joignable que via Caddy (localhost), jamais directement depuis l'extérieur.
log "Configuration du pare-feu (ufw)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# --- 9. Mise à jour périodique de l'IP DuckDNS (filet de sécurité, §8.3) -----------
log "Configuration de la mise à jour périodique DuckDNS"
mkdir -p /opt/duckdns
cat > /opt/duckdns/update.sh <<EOF
#!/usr/bin/env bash
curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=" \\
  -o /var/log/duckdns.log
EOF
chmod +x /opt/duckdns/update.sh

cat > /etc/systemd/system/duckdns-update.service <<'EOF'
[Unit]
Description=Mise a jour de l'IP DuckDNS

[Service]
Type=oneshot
ExecStart=/opt/duckdns/update.sh
EOF

cat > /etc/systemd/system/duckdns-update.timer <<'EOF'
[Unit]
Description=Lance la mise a jour DuckDNS toutes les 5 minutes

[Timer]
OnBootSec=30
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now duckdns-update.timer

# --- Résumé -------------------------------------------------------------------------
log "Terminé."
echo "Serveur de jeu : systemctl status angulio        (écoute sur 127.0.0.1:${GAME_PORT})"
echo "Reverse proxy  : systemctl status caddy           (https://${DOMAIN})"
echo "DuckDNS        : systemctl status duckdns-update.timer"
echo
echo "Étape manuelle restante (hors de portée de ce script, §8.2 du plan) :"
echo "  configurer la redirection de port (NAT/PAT) sur la box Internet vers l'IP"
echo "  locale de cette machine, ports 80 et 443 (TCP)."
