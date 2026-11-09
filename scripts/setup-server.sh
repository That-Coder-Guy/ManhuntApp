#!/usr/bin/env bash
#
# Set up the Manhunt server on a Debian-based machine (Raspberry Pi OS,
# Ubuntu, Debian) and publish it over HTTPS with a Cloudflare Tunnel.
#
# Safe to re-run: it skips what is already installed, rebuilds the app, and
# restarts it, so it is also how you deploy an update after `git pull`.
# Settings from earlier runs (port, allowed origins, tunnel) are kept unless
# you pass new ones, and the tunnel is only restarted if its settings changed.
#
# Tunnel modes:
#   --quick
#       No domain or Cloudflare account needed: Cloudflare gives the server a
#       free https://<random-words>.trycloudflare.com address. The address
#       changes whenever the tunnel restarts (a reboot, for example); run
#       `scripts/setup-server.sh --url` to see the current one.
#   --hostname manhunt.example.com
#       Fully scripted. Needs a domain on your (free) Cloudflare account. The
#       first run prints a login link to open in any browser; then it creates
#       the tunnel and its DNS record for you.
#   --token <TOKEN>
#       Uses a tunnel you created in the Cloudflare dashboard (Zero Trust →
#       Networks → Tunnels). Point its public hostname at
#       http://localhost:3001 there. Add --hostname too to have the script
#       check that the public address works.
#   --no-tunnel
#       Only the app service (for example behind your own reverse proxy).
#
# Run it as your normal user from inside the repository; it uses sudo where
# it needs to.

set -euo pipefail

# ---------- settings ----------
QUICK_METRICS="127.0.0.1:20241"   # cloudflared reports the quick tunnel's address here
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="manhunt"
TUNNEL_SERVICE_NAME="manhunt-tunnel"
# Overridable so the script can be exercised without touching the real system
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
CF_DIR="${CF_DIR:-/etc/cloudflared}"
CF_USER_DIR="${CF_USER_DIR:-$HOME/.cloudflared}"

PORT=""
PUBLIC_HOST=""
TOKEN=""
TUNNEL_NAME="manhunt"
ORIGINS=()
NO_TUNNEL=0
QUICK=0
SHOW_URL=0
NO_BUILD=0
DRY_RUN=0

# ---------- output ----------
if [[ -t 1 ]]; then BOLD=$'\e[1m'; DIM=$'\e[2m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; RESET=$'\e[0m'
else BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; RESET=""; fi
step() { printf '\n%s▸ %s%s\n' "$BOLD" "$*" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
note() { printf '  %s%s%s\n' "$DIM" "$*" "$RESET"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()  { printf '\n%s✖ %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }
# A finished step, or in a dry run what would have happened
did()  { if (( DRY_RUN )); then ok "Would: $*"; else ok "$*"; fi; }

usage() {
    sed -n '3,31p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    cat <<'EOF'

Options:
  --quick                Free trycloudflare.com address, no domain needed
  --url                  Print the server's current public address and exit
  --hostname HOST        Public hostname, e.g. manhunt.example.com
  --token TOKEN          Token of a dashboard-managed tunnel
  --tunnel-name NAME     Tunnel name for --hostname mode (default: manhunt)
  --port PORT            Local port for the app (default: 3001)
  --allow-origin URL     Extra site allowed to use the server, e.g. a frontend
                         hosted elsewhere. Repeatable.
  --no-tunnel            Set up the app service only
  --no-build             Skip npm install and the build (restart only)
  --dry-run              Show what would be done without doing it
  -h, --help             Show this help
EOF
}

# ---------- arguments ----------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --hostname)     PUBLIC_HOST="${2:-}"; shift 2 ;;
        --token)        TOKEN="${2:-}"; shift 2 ;;
        --tunnel-name)  TUNNEL_NAME="${2:-}"; shift 2 ;;
        --port)         PORT="${2:-}"; shift 2 ;;
        --allow-origin) ORIGINS+=("${2:-}"); shift 2 ;;
        --no-tunnel)    NO_TUNNEL=1; shift ;;
        --quick)        QUICK=1; shift ;;
        --url)          SHOW_URL=1; shift ;;
        --no-build)     NO_BUILD=1; shift ;;
        --dry-run)      DRY_RUN=1; shift ;;
        -h|--help)      usage; exit 0 ;;
        *)              usage >&2; die "Unknown option: $1" ;;
    esac
done

[[ -z "$PUBLIC_HOST" || "$PUBLIC_HOST" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]] \
    || die "--hostname must be a bare hostname like manhunt.example.com (no https://, no path)"
[[ -z "$PORT" || "$PORT" =~ ^[0-9]+$ && "$PORT" -ge 1 && "$PORT" -le 65535 ]] || die "--port must be a number from 1 to 65535"
[[ "$TUNNEL_NAME" =~ ^[a-zA-Z0-9_-]+$ ]] || die "--tunnel-name may only use letters, digits, - and _"
for origin in "${ORIGINS[@]+"${ORIGINS[@]}"}"; do
    [[ "$origin" =~ ^https?://[^/]+$ ]] || die "--allow-origin must look like https://games.example.com (no path, no trailing slash)"
done
[[ -z "$TOKEN" || "$TOKEN" =~ ^[A-Za-z0-9+/=_-]{20,}$ ]] || die "--token doesn't look like a Cloudflare tunnel token"
(( NO_TUNNEL == 0 )) || [[ -z "$TOKEN" ]] || die "--token and --no-tunnel can't be used together"
(( QUICK == 0 )) || [[ -z "$TOKEN$PUBLIC_HOST" ]] || die "--quick gives you a Cloudflare address; it can't be combined with --token or --hostname"
(( QUICK == 0 || NO_TUNNEL == 0 )) || die "--quick and --no-tunnel can't be used together"

# ---------- helpers ----------
if [[ $EUID -eq 0 ]]; then
    SUDO=()
    APP_USER="${SUDO_USER:-root}"
    (( SHOW_URL )) || [[ "$APP_USER" != root ]] || warn "Running as root, so the app service will run as root too. A normal user with sudo is better."
else
    command -v sudo >/dev/null || die "sudo is needed (or run as root)"
    SUDO=(sudo)
    APP_USER="$(id -un)"
fi

run() {
    if (( DRY_RUN )); then printf '  %s+ %s%s\n' "$DIM" "$*" "$RESET"; else "$@"; fi
}
as_root() { run "${SUDO[@]+"${SUDO[@]}"}" "$@"; }

# Write a root-owned file only if its content changed; prints "changed"/"same"
write_root_file() {
    local path="$1" mode="$2" content="$3"
    if [[ -f "$path" ]] && [[ "$(cat "$path" 2>/dev/null || true)" == "$content" ]]; then echo same; return; fi
    if (( DRY_RUN )); then
        printf '  %s+ write %s (mode %s)%s\n' "$DIM" "$path" "$mode" "$RESET" >&2
    else
        "${SUDO[@]+"${SUDO[@]}"}" mkdir -p "$(dirname "$path")"
        printf '%s\n' "$content" | "${SUDO[@]+"${SUDO[@]}"}" tee "$path" >/dev/null
        "${SUDO[@]+"${SUDO[@]}"}" chmod "$mode" "$path"
    fi
    echo changed
}

# A value from an existing unit/env file, so re-runs keep earlier settings
existing_env() {
    local file="$1" key="$2"
    [[ -r "$file" ]] || return 0
    sed -n "s/^Environment=${key}=//p; s/^${key}=//p" "$file" | head -n 1
}

wait_for_url() {
    local url="$1" tries="$2" delay="$3"
    for (( i = 0; i < tries; i++ )); do
        curl -fsS --max-time 5 "$url" >/dev/null 2>&1 && return 0
        sleep "$delay"
    done
    return 1
}

# The quick tunnel's current https://….trycloudflare.com address, or nothing
quick_url() {
    local host
    host="$(curl -fsS --max-time 3 "http://$QUICK_METRICS/quicktunnel" 2>/dev/null \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).hostname||"")}catch{}})' || true)"
    if [[ -n "$host" ]]; then echo "https://$host"; return; fi
    # Older cloudflared: read it from the tunnel's log instead
    journalctl -u "$TUNNEL_SERVICE_NAME" --no-pager -n 300 2>/dev/null \
        | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -n 1 || true
}

# Which tunnel mode the installed tunnel service uses (quick/token/hostname)
saved_mode() {
    [[ -r "$1" ]] && sed -n 's/^# tunnel-mode: //p' "$1" | head -n 1
}

node_is_new_enough() {
    command -v node >/dev/null || return 1
    # The server shares an ES module with the app, which needs Node 20.19+ or 22.12+
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);
        process.exit(a>22 || (a===22&&b>=12) || a===21 || (a===20&&b>=19) ? 0 : 1)'
}

APP_UNIT="$SYSTEMD_DIR/$SERVICE_NAME.service"
TUNNEL_UNIT="$SYSTEMD_DIR/$TUNNEL_SERVICE_NAME.service"

# --url: just report where the server can be reached
if (( SHOW_URL )); then
    case "$(saved_mode "$TUNNEL_UNIT")" in
        quick)
            url="$(quick_url)"
            [[ -n "$url" ]] || die "The quick tunnel has no address yet. Is it running? systemctl status $TUNNEL_SERVICE_NAME"
            echo "$url" ;;
        hostname)
            echo "https://$(sed -n 's/^  - hostname: //p' "$CF_DIR/$TUNNEL_SERVICE_NAME.yml" | head -n 1)" ;;
        token)
            echo "The address is the public hostname set for this tunnel in the Cloudflare dashboard." ;;
        *)
            die "No tunnel is set up. Run: scripts/setup-server.sh --quick" ;;
    esac
    exit 0
fi

# Keep earlier settings unless new ones were given
[[ -n "$PORT" ]] || PORT="$(existing_env "$APP_UNIT" PORT)"
PORT="${PORT:-3001}"
if (( ${#ORIGINS[@]} == 0 )); then
    PREVIOUS_ORIGINS="$(existing_env "$APP_UNIT" ALLOWED_ORIGINS)"
    [[ -z "$PREVIOUS_ORIGINS" ]] || IFS=',' read -r -a ORIGINS <<< "$PREVIOUS_ORIGINS"
fi

printf '%sManhunt server setup%s\n' "$BOLD" "$RESET"
note "Repository: $REPO_DIR"
note "Runs as:    $APP_USER, on port $PORT"
(( DRY_RUN )) && note "Dry run: nothing will be changed"

command -v apt-get >/dev/null || die "This script needs a Debian-based system (apt-get not found)"

# ---------- 1. System packages and Node ----------
step "Checking Node.js"
for tool in curl git; do
    if ! command -v "$tool" >/dev/null; then
        as_root apt-get update -qq
        as_root apt-get install -y -qq curl git ca-certificates
        break
    fi
done
if node_is_new_enough; then
    ok "Node $(node --version) is installed"
else
    note "Installing Node.js 22 from NodeSource…"
    if (( DRY_RUN )); then
        run "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    else
        curl -fsSL https://deb.nodesource.com/setup_22.x | "${SUDO[@]+"${SUDO[@]}"}" -E bash -
    fi
    as_root apt-get install -y -qq nodejs
    (( DRY_RUN )) || node_is_new_enough || die "Node.js is still too old after installing; install Node 22 manually"
    if (( DRY_RUN )); then ok "Node 22 would be installed"; else ok "Node $(node --version) installed"; fi
fi

# ---------- 2. Build ----------
step "Building the app"
if (( NO_BUILD )); then
    note "Skipped (--no-build)"
else
    cd "$REPO_DIR"
    run npm ci --no-audit --no-fund --loglevel=error
    run npm --prefix server ci --no-audit --no-fund --loglevel=error
    # Single origin: the frontend talks to the server it was loaded from
    run npm run --silent build:selfhost
    did "Built into dist/"
fi

# ---------- 3. App service ----------
step "Installing the $SERVICE_NAME service"
NODE_BIN="$(command -v node || echo /usr/bin/node)"
ORIGINS_LINE=""
if (( ${#ORIGINS[@]} > 0 )); then
    ORIGINS_LINE="Environment=ALLOWED_ORIGINS=$(IFS=','; echo "${ORIGINS[*]}")"
fi
APP_UNIT_CONTENT="# Written by scripts/setup-server.sh; re-run it rather than editing this file.
[Unit]
Description=Manhunt game server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$REPO_DIR
ExecStart=$NODE_BIN server/server.js
Environment=NODE_ENV=production
Environment=PORT=$PORT
${ORIGINS_LINE}
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target"
write_root_file "$APP_UNIT" 644 "$APP_UNIT_CONTENT" >/dev/null
as_root systemctl daemon-reload
as_root systemctl enable "$SERVICE_NAME" --quiet
as_root systemctl restart "$SERVICE_NAME"
if (( DRY_RUN )); then
    ok "Would start $SERVICE_NAME"
elif wait_for_url "http://127.0.0.1:$PORT/manhunt-api/health" 30 0.5; then
    ok "Server is up at http://127.0.0.1:$PORT"
else
    die "The server didn't come up. See: journalctl -u $SERVICE_NAME -n 50"
fi
(( ${#ORIGINS[@]} == 0 )) || note "Also allows: ${ORIGINS[*]}"

# ---------- 4. Cloudflare Tunnel ----------
MODE="none"
if (( NO_TUNNEL )); then
    MODE="none"
elif (( QUICK )); then
    MODE="quick"
elif [[ -n "$TOKEN" ]]; then
    MODE="token"
elif [[ -n "$PUBLIC_HOST" ]]; then
    MODE="hostname"
elif [[ "$(saved_mode "$TUNNEL_UNIT")" == quick ]]; then
    MODE="quick"    # keep it; rewritten only if the port changed
elif [[ -f "$TUNNEL_UNIT" ]]; then
    MODE="existing"
fi
TUNNEL_CHANGED=0

install_cloudflared() {
    if command -v cloudflared >/dev/null; then ok "$(cloudflared --version 2>&1 | head -n 1)"; return; fi
    note "Installing cloudflared from Cloudflare's package repository…"
    if (( DRY_RUN )); then run "add pkg.cloudflare.com apt repository; apt-get install cloudflared"; return; fi
    if "${SUDO[@]+"${SUDO[@]}"}" mkdir -p --mode=0755 /usr/share/keyrings \
        && curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | "${SUDO[@]+"${SUDO[@]}"}" tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null \
        && echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
            | "${SUDO[@]+"${SUDO[@]}"}" tee /etc/apt/sources.list.d/cloudflared.list >/dev/null \
        && "${SUDO[@]+"${SUDO[@]}"}" apt-get update -qq \
        && "${SUDO[@]+"${SUDO[@]}"}" apt-get install -y -qq cloudflared; then
        ok "$(cloudflared --version 2>&1 | head -n 1)"
        return
    fi
    warn "The package repository didn't work; downloading the release package instead"
    local arch deb
    arch="$(dpkg --print-architecture)"
    deb="$(mktemp --suffix=.deb)"
    curl -fsSL -o "$deb" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb" \
        || die "Couldn't download cloudflared for $arch. Install it by hand: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    "${SUDO[@]+"${SUDO[@]}"}" dpkg -i "$deb"
    rm -f "$deb"
    ok "$(cloudflared --version 2>&1 | head -n 1)"
}

# ID of the named tunnel on this Cloudflare account, or nothing
tunnel_id() {
    cloudflared tunnel list --output json --name "$TUNNEL_NAME" 2>/dev/null \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s||"[]");process.stdout.write((t[0]&&t[0].id)||"")}catch{}})'
}

step "Cloudflare Tunnel"
case "$MODE" in
    none)
        if (( NO_TUNNEL )); then note "Skipped (--no-tunnel)"
        else
            note "No tunnel configured. Re-run with --quick (a free trycloudflare.com address),"
            note "--hostname manhunt.example.com (your own domain), or --token <TOKEN> (a dashboard tunnel)."
        fi
        ;;
    existing)
        # Nothing about the tunnel changed: make sure it runs, don't restart it
        as_root systemctl enable --now "$TUNNEL_SERVICE_NAME" --quiet
        did "Tunnel $TUNNEL_SERVICE_NAME left running"
        ;;
    quick)
        install_cloudflared
        CF_BIN="$(command -v cloudflared || echo /usr/bin/cloudflared)"
        # A config.yml in the default place makes cloudflared ignore --url
        [[ ! -f "$CF_DIR/config.yml" ]] || warn "$CF_DIR/config.yml exists and may stop the quick tunnel from starting; move it aside if it does"
        TUNNEL_EXEC="$CF_BIN --no-autoupdate tunnel --metrics $QUICK_METRICS --url http://localhost:$PORT"
        TUNNEL_ENV_LINE=""
        ;;
    token)
        install_cloudflared
        CF_BIN="$(command -v cloudflared || echo /usr/bin/cloudflared)"
        # The token is a secret: keep it out of the (world-readable) unit file
        [[ "$(write_root_file "$CF_DIR/$TUNNEL_SERVICE_NAME.env" 600 "TUNNEL_TOKEN=$TOKEN")" == same ]] || TUNNEL_CHANGED=1
        TUNNEL_EXEC="$CF_BIN --no-autoupdate tunnel run"
        TUNNEL_ENV_LINE=$'\n'"EnvironmentFile=$CF_DIR/$TUNNEL_SERVICE_NAME.env"
        did "Token saved to $CF_DIR/$TUNNEL_SERVICE_NAME.env (readable by root only)"
        note "In the dashboard, the tunnel's public hostname must point to http://localhost:$PORT"
        ;;
    hostname)
        install_cloudflared
        CF_BIN="$(command -v cloudflared || echo /usr/bin/cloudflared)"
        if [[ ! -f "$CF_USER_DIR/cert.pem" ]]; then
            note "Log in to Cloudflare: open the link below on any device and pick the domain for $PUBLIC_HOST."
            run cloudflared tunnel login
            (( DRY_RUN )) || [[ -f "$CF_USER_DIR/cert.pem" ]] || die "Cloudflare login didn't finish (no $CF_USER_DIR/cert.pem)"
        else
            ok "Already logged in to Cloudflare"
        fi

        if (( DRY_RUN )); then TUNNEL_ID="<tunnel-id>"; else TUNNEL_ID="$(tunnel_id)"; fi
        if [[ -z "$TUNNEL_ID" ]]; then
            run cloudflared tunnel create "$TUNNEL_NAME" >/dev/null
            TUNNEL_ID="$(tunnel_id)"
            [[ -n "$TUNNEL_ID" ]] || die "Couldn't create the tunnel \"$TUNNEL_NAME\""
            did "Created tunnel \"$TUNNEL_NAME\" ($TUNNEL_ID)"
        else
            did "Use tunnel \"$TUNNEL_NAME\" ($TUNNEL_ID)"
        fi

        CREDS="$CF_USER_DIR/$TUNNEL_ID.json"
        if (( ! DRY_RUN )) && [[ ! -f "$CREDS" ]]; then
            # Tunnel exists but was created elsewhere: fetch its credentials
            cloudflared tunnel token --cred-file "$CREDS" "$TUNNEL_NAME" >/dev/null \
                || die "No credentials for tunnel \"$TUNNEL_NAME\" on this machine. Use another --tunnel-name, or delete it with: cloudflared tunnel delete $TUNNEL_NAME"
        fi
        as_root install -d -m 755 "$CF_DIR"
        as_root install -m 600 "$CREDS" "$CF_DIR/$TUNNEL_ID.json"

        run cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$PUBLIC_HOST" >/dev/null
        did "DNS: $PUBLIC_HOST → tunnel \"$TUNNEL_NAME\""

        CONFIG_CONTENT="# Written by scripts/setup-server.sh
tunnel: $TUNNEL_ID
credentials-file: $CF_DIR/$TUNNEL_ID.json
ingress:
  - hostname: $PUBLIC_HOST
    service: http://localhost:$PORT
  - service: http_status:404"
        [[ "$(write_root_file "$CF_DIR/$TUNNEL_SERVICE_NAME.yml" 644 "$CONFIG_CONTENT")" == same ]] || TUNNEL_CHANGED=1
        TUNNEL_EXEC="$CF_BIN --no-autoupdate --config $CF_DIR/$TUNNEL_SERVICE_NAME.yml tunnel run"
        TUNNEL_ENV_LINE=""
        ;;
esac

if [[ "$MODE" == quick || "$MODE" == token || "$MODE" == hostname ]]; then
    TUNNEL_UNIT_CONTENT="# Written by scripts/setup-server.sh; re-run it rather than editing this file.
# tunnel-mode: $MODE
[Unit]
Description=Cloudflare Tunnel for Manhunt
After=network-online.target $SERVICE_NAME.service
Wants=network-online.target

[Service]
Type=simple${TUNNEL_ENV_LINE}
ExecStart=$TUNNEL_EXEC
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target"
    [[ "$(write_root_file "$TUNNEL_UNIT" 644 "$TUNNEL_UNIT_CONTENT")" == same ]] || TUNNEL_CHANGED=1
    as_root systemctl daemon-reload
    if (( TUNNEL_CHANGED )); then
        # New settings need a restart (a quick tunnel gets a new address)
        as_root systemctl enable "$TUNNEL_SERVICE_NAME" --quiet
        as_root systemctl restart "$TUNNEL_SERVICE_NAME"
        did "Tunnel service $TUNNEL_SERVICE_NAME started"
    else
        as_root systemctl enable --now "$TUNNEL_SERVICE_NAME" --quiet
        did "Tunnel $TUNNEL_SERVICE_NAME unchanged, left running"
    fi
fi

# A quick tunnel's address is only known once cloudflared has it
if [[ "$MODE" == quick ]]; then
    if (( DRY_RUN )); then
        PUBLIC_URL="https://<random-words>.trycloudflare.com"
    else
        PUBLIC_URL=""
        for (( i = 0; i < 30; i++ )); do
            PUBLIC_URL="$(quick_url)"
            [[ -z "$PUBLIC_URL" ]] || break
            sleep 1
        done
        [[ -n "$PUBLIC_URL" ]] || die "The quick tunnel didn't report an address. See: journalctl -u $TUNNEL_SERVICE_NAME -n 50"
    fi
    PUBLIC_HOST="${PUBLIC_URL#https://}"
fi

# An earlier version could install a manhunt-publish service (for a Vercel
# frontend); stop it and delete its file, which holds a Vercel token
LEGACY_PUBLISH_UNIT="$SYSTEMD_DIR/manhunt-publish.service"
if [[ -f "$LEGACY_PUBLISH_UNIT" ]]; then
    as_root systemctl disable --now manhunt-publish --quiet || true
    as_root rm -f "$LEGACY_PUBLISH_UNIT" "$CF_DIR/manhunt-publish.env"
    as_root systemctl daemon-reload
    did "Removed the old manhunt-publish service and its token file"
fi

# ---------- 5. Public check ----------
if [[ -n "$PUBLIC_HOST" && "$MODE" != none ]]; then
    step "Checking https://$PUBLIC_HOST"
    if (( DRY_RUN )); then
        note "Skipped in a dry run"
    elif wait_for_url "https://$PUBLIC_HOST/manhunt-api/health" 24 5; then
        ok "Live: https://$PUBLIC_HOST"
    else
        warn "Not reachable yet. New addresses can take a minute or two to work; try:"
        warn "  curl https://$PUBLIC_HOST/manhunt-api/health"
        warn "Tunnel logs: journalctl -u $TUNNEL_SERVICE_NAME -n 50"
    fi
fi

# ---------- Summary ----------
step "Done"
if [[ -n "$PUBLIC_HOST" && "$MODE" != none ]]; then
    printf '\n  %sPlay at:  https://%s%s\n\n' "$BOLD" "$PUBLIC_HOST" "$RESET"
fi
if [[ "$MODE" == quick ]]; then
    note "This address changes whenever the tunnel restarts (a reboot, for example)."
    note "See the current one any time with: scripts/setup-server.sh --url"
    note "Open it on your phone and use the in-app Invite button: the QR code follows the address."
fi
note "Local:    http://127.0.0.1:$PORT"
TUNNEL_LOGS=""
[[ -f "$TUNNEL_UNIT" || "$MODE" != none ]] && TUNNEL_LOGS="   ·   journalctl -u $TUNNEL_SERVICE_NAME -f"
note "Logs:     journalctl -u $SERVICE_NAME -f$TUNNEL_LOGS"
note "Update:   git pull && scripts/setup-server.sh"
