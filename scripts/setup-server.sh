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
# Frontend on Vercel with a --quick tunnel: add --vercel-site, --vercel-token
# and --global-config, and a small service keeps the Vercel site pointed at the
# tunnel's current address, even after it changes (see the README).
#
# Run it as your normal user from inside the repository; it uses sudo where
# it needs to.

set -euo pipefail

# ---------- settings ----------
QUICK_METRICS="127.0.0.1:20241"   # cloudflared reports the quick tunnel's address here
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="manhunt"
TUNNEL_SERVICE_NAME="manhunt-tunnel"
PUBLISH_SERVICE_NAME="manhunt-publish"
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
VERCEL_SITE=""
VERCEL_TOKEN=""
GLOBAL_CONFIG_ID=""
VERCEL_TEAM_ID=""
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
    sed -n '3,35p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    cat <<'EOF'

Options:
  --quick                Free trycloudflare.com address, no domain needed
  --url                  Print the server's current public address and exit
  --hostname HOST        Public hostname, e.g. manhunt.example.com
  --token TOKEN          Token of a dashboard-managed tunnel
  --tunnel-name NAME     Tunnel name for --hostname mode (default: manhunt)
  --port PORT            Local port for the app (default: 3001)
  --allow-origin URL     Extra site allowed to use the server, e.g. a Vercel
                         frontend (https://your-app.vercel.app). Repeatable.
  --no-tunnel            Set up the app service only
  --vercel-site URL      Your Vercel frontend, e.g. https://your-app.vercel.app;
                         with the next two, publishes the quick tunnel's
                         address to it whenever it changes
  --vercel-token TOKEN   Vercel access token (Account Settings → Tokens)
  --global-config ID     The Vercel project's Global Config ID (ecfg_…)
  --vercel-team ID       Only if the project is in a Vercel team (team_…)
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
        --vercel-site)  VERCEL_SITE="${2:-}"; shift 2 ;;
        --vercel-token) VERCEL_TOKEN="${2:-}"; shift 2 ;;
        --global-config) GLOBAL_CONFIG_ID="${2:-}"; shift 2 ;;
        --vercel-team)  VERCEL_TEAM_ID="${2:-}"; shift 2 ;;
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
    [[ "$origin" =~ ^https?://[^/]+$ ]] || die "--allow-origin must look like https://your-app.vercel.app (no path, no trailing slash)"
done
[[ -z "$TOKEN" || "$TOKEN" =~ ^[A-Za-z0-9+/=_-]{20,}$ ]] || die "--token doesn't look like a Cloudflare tunnel token"
(( NO_TUNNEL == 0 )) || [[ -z "$TOKEN" ]] || die "--token and --no-tunnel can't be used together"
(( QUICK == 0 )) || [[ -z "$TOKEN$PUBLIC_HOST" ]] || die "--quick gives you a Cloudflare address; it can't be combined with --token or --hostname"
(( QUICK == 0 || NO_TUNNEL == 0 )) || die "--quick and --no-tunnel can't be used together"
[[ -z "$VERCEL_SITE" || "$VERCEL_SITE" =~ ^https://[^/]+$ ]] || die "--vercel-site must look like https://your-app.vercel.app (no path, no trailing slash)"
[[ -z "$VERCEL_TOKEN" || "$VERCEL_TOKEN" =~ ^[A-Za-z0-9_-]{16,}$ ]] || die "--vercel-token doesn't look like a Vercel access token"
[[ -z "$GLOBAL_CONFIG_ID" || "$GLOBAL_CONFIG_ID" =~ ^ecfg_[A-Za-z0-9]+$ ]] || die "--global-config must be the store's ID, like ecfg_abc123 (Vercel → Storage → your Global Config store)"
[[ -z "$VERCEL_TEAM_ID" || "$VERCEL_TEAM_ID" =~ ^team_[A-Za-z0-9]+$ ]] || die "--vercel-team must look like team_abc123"

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

# Like existing_env, for root-only files (they hold tokens)
existing_secret() {
    local file="$1" key="$2"
    [[ -e "$file" ]] || return 0
    "${SUDO[@]+"${SUDO[@]}"}" sed -n "s/^${key}=//p" "$file" 2>/dev/null | head -n 1 || true
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

# The publisher's latest report, e.g. "Published https://…" or "Vercel answered 403 …"
publisher_status() {
    "${SUDO[@]+"${SUDO[@]}"}" journalctl -u "$PUBLISH_SERVICE_NAME" --no-pager -o cat -n 50 2>/dev/null \
        | grep -E '^(Watching|Published|Vercel answered|Couldn.t reach|Missing|Waiting)' | tail -n 1 || true
}

# Ask the Vercel site where the server is until it says PUBLIC_URL, or explain
# exactly why it doesn't
check_vercel_site() {
    local endpoint="$VERCEL_SITE/api/server-origin" body_file reply code redirect origin="" since_published=0
    body_file="$(mktemp)"
    for (( i = 0; i < 30; i++ )); do
        reply="$(curl -sS --max-time 8 -o "$body_file" -w '%{http_code} %{redirect_url}' "$endpoint" 2>/dev/null || true)"
        code="${reply%% *}"; redirect="${reply#* }"
        origin="$(grep -o '"origin":[^,}]*' "$body_file" 2>/dev/null | head -n 1 | sed 's/^"origin"://; s/"//g' || true)"
        if [[ "$code" == 200 && "$origin" == "$PUBLIC_URL" ]]; then
            rm -f "$body_file"
            ok "$endpoint → $PUBLIC_URL"
            return 0
        fi
        # Only "not published yet" is worth waiting for, and only while the
        # publisher hasn't already been refused
        if [[ "$code" != 200 ]] || ! grep -q '"origin"' "$body_file"; then break; fi
        case "$(publisher_status)" in
            "Vercel answered"*) break ;;
            # Published, but the site still can't see it: a store problem
            "Published $PUBLIC_URL") (( ++since_published < 10 )) || break ;;
        esac
        sleep 3
    done

    local publisher
    publisher="$(publisher_status)"
    warn "$VERCEL_SITE doesn't point at this server yet."
    if [[ "$code" == 401 || "$code" == 403 || "$redirect" == *vercel.com* ]] || grep -qi 'vercel authentication\|sso-api' "$body_file" 2>/dev/null; then
        warn "It asks visitors to log in to Vercel (Deployment Protection), so the app can't"
        warn "read the address, and friends would get a Vercel login page too."
        [[ "$VERCEL_SITE" != *-git-* ]] || warn "Addresses with -git-<branch>- in them are branch links, which Vercel protects by default."
        warn "Fix: use the project's production address (Vercel → project → Overview → Domains,"
        warn "e.g. https://<project>.vercel.app) and re-run with --vercel-site <that address>,"
        warn "or turn off Vercel Authentication in Settings → Deployment Protection."
    elif [[ "$code" == 000 || -z "$code" ]]; then
        warn "Couldn't reach $VERCEL_SITE at all. Check the address (open it in a browser)."
    elif [[ "$code" == 404 ]]; then
        warn "This deployment has no /api/server-origin. In Vercel, redeploy the latest main"
        warn "(Deployments → ⋯ → Redeploy), and check Settings → General → Root Directory is empty."
    elif [[ "$code" =~ ^5 ]]; then
        warn "The site's /api/server-origin function failed (HTTP $code). See Vercel → project → Logs."
    elif [[ "$code" == 200 ]] && ! grep -q '"origin"' "$body_file"; then
        warn "It answers with the app's page instead of the function, so Vercel didn't deploy"
        warn "the api/ folder. Check Settings → General → Root Directory is empty, then redeploy."
    elif [[ "$publisher" == Published* ]]; then
        warn "The Pi published its address, but the site reads ${origin:-nothing}."
        warn "Connect the Global Config store to this project (Storage tab → the store → Projects),"
        warn "make sure it's the store with ID $GLOBAL_CONFIG_ID, then redeploy."
    elif [[ "$publisher" == "Vercel answered 40"[13]* ]]; then
        warn "Vercel refused the Pi's token: re-run with --vercel-token <a new token>, and add"
        warn "--vercel-team team_… if the project is in a team."
    elif [[ "$publisher" == "Vercel answered 404"* ]]; then
        warn "Vercel wouldn't store the address in $GLOBAL_CONFIG_ID. Check the ID on the store's"
        warn "page (Storage → the store), and add --vercel-team team_… if the project is in a team."
    else
        warn "The site answered: $(head -c 200 "$body_file" 2>/dev/null)"
    fi
    [[ -z "$publisher" ]] || warn "Publisher's latest report: $publisher"
    warn "Check again any time: curl $endpoint"
    rm -f "$body_file"
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

# Which tunnel to run
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

# Publishing the tunnel's address to a Vercel frontend
PUBLISH_ENV="$CF_DIR/$PUBLISH_SERVICE_NAME.env"
PUBLISH_UNIT="$SYSTEMD_DIR/$PUBLISH_SERVICE_NAME.service"
[[ -n "$VERCEL_SITE" ]] || VERCEL_SITE="$(existing_secret "$PUBLISH_ENV" VERCEL_SITE)"
[[ -n "$VERCEL_TOKEN" ]] || VERCEL_TOKEN="$(existing_secret "$PUBLISH_ENV" VERCEL_TOKEN)"
[[ -n "$GLOBAL_CONFIG_ID" ]] || GLOBAL_CONFIG_ID="$(existing_secret "$PUBLISH_ENV" GLOBAL_CONFIG_ID)"
[[ -n "$VERCEL_TEAM_ID" ]] || VERCEL_TEAM_ID="$(existing_secret "$PUBLISH_ENV" VERCEL_TEAM_ID)"
PUBLISH=0
if [[ -n "$VERCEL_SITE$VERCEL_TOKEN$GLOBAL_CONFIG_ID" ]]; then
    missing=()
    [[ -n "$VERCEL_SITE" ]] || missing+=(--vercel-site)
    [[ -n "$VERCEL_TOKEN" ]] || missing+=(--vercel-token)
    [[ -n "$GLOBAL_CONFIG_ID" ]] || missing+=(--global-config)
    (( ${#missing[@]} == 0 )) || die "Publishing to Vercel also needs: ${missing[*]}"
    [[ "$MODE" == quick ]] || die "Publishing to Vercel is for --quick tunnels. With a fixed address, set VITE_API_ORIGIN in Vercel instead (see the README)."
    PUBLISH=1
    # The Vercel site must be allowed to use the server
    [[ " ${ORIGINS[*]+"${ORIGINS[*]}"} " == *" $VERCEL_SITE "* ]] || ORIGINS+=("$VERCEL_SITE")
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

# ---------- 6. Vercel ----------
if (( PUBLISH )); then
    step "Pointing $VERCEL_SITE at this server"
    PUBLISH_ENV_CONTENT="VERCEL_SITE=$VERCEL_SITE
VERCEL_TOKEN=$VERCEL_TOKEN
GLOBAL_CONFIG_ID=$GLOBAL_CONFIG_ID${VERCEL_TEAM_ID:+
VERCEL_TEAM_ID=$VERCEL_TEAM_ID}"
    PUBLISH_CHANGED=0
    # The token is a secret: root-only, like the tunnel token
    [[ "$(write_root_file "$PUBLISH_ENV" 600 "$PUBLISH_ENV_CONTENT")" == same ]] || PUBLISH_CHANGED=1
    PUBLISH_UNIT_CONTENT="# Written by scripts/setup-server.sh; re-run it rather than editing this file.
[Unit]
Description=Publish Manhunt's tunnel address to its Vercel frontend
After=network-online.target $TUNNEL_SERVICE_NAME.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$REPO_DIR
ExecStart=$NODE_BIN scripts/publish-address.mjs
EnvironmentFile=$PUBLISH_ENV
Environment=QUICK_METRICS=$QUICK_METRICS
StateDirectory=$PUBLISH_SERVICE_NAME
Restart=always
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target"
    [[ "$(write_root_file "$PUBLISH_UNIT" 644 "$PUBLISH_UNIT_CONTENT")" == same ]] || PUBLISH_CHANGED=1
    as_root systemctl daemon-reload
    if (( PUBLISH_CHANGED || NO_BUILD == 0 )); then
        # Also after a rebuild, which may have updated the publisher itself
        as_root systemctl enable "$PUBLISH_SERVICE_NAME" --quiet
        as_root systemctl restart "$PUBLISH_SERVICE_NAME"
    else
        as_root systemctl enable --now "$PUBLISH_SERVICE_NAME" --quiet
    fi
    did "Service $PUBLISH_SERVICE_NAME keeps the site pointed at the tunnel"

    if (( DRY_RUN )); then
        note "Check skipped in a dry run"
    else
        check_vercel_site
    fi
fi

# ---------- Summary ----------
step "Done"
if (( PUBLISH )); then
    printf '\n  %sPlay at:  %s%s\n\n' "$BOLD" "$VERCEL_SITE" "$RESET"
    note "Server:   $PUBLIC_URL"
    note "The site finds the server by itself, even when the tunnel's address changes."
elif [[ -n "$PUBLIC_HOST" && "$MODE" != none ]]; then
    printf '\n  %sPlay at:  https://%s%s\n\n' "$BOLD" "$PUBLIC_HOST" "$RESET"
fi
if [[ "$MODE" == quick ]] && (( ! PUBLISH )); then
    note "This address changes whenever the tunnel restarts (a reboot, for example)."
    note "See the current one any time with: scripts/setup-server.sh --url"
    note "Open it on your phone and use the in-app Invite button: the QR code follows the address."
fi
note "Local:    http://127.0.0.1:$PORT"
TUNNEL_LOGS=""
[[ -f "$TUNNEL_UNIT" || "$MODE" != none ]] && TUNNEL_LOGS="   ·   journalctl -u $TUNNEL_SERVICE_NAME -f"
(( ! PUBLISH )) || TUNNEL_LOGS="$TUNNEL_LOGS   ·   journalctl -u $PUBLISH_SERVICE_NAME -f"
note "Logs:     journalctl -u $SERVICE_NAME -f$TUNNEL_LOGS"
note "Update:   git pull && scripts/setup-server.sh"
if (( PUBLISH )); then
    :
elif [[ "$MODE" == quick ]]; then
    note "Frontend on Vercel? Re-run with --vercel-site, --vercel-token and --global-config"
    note "          so it follows this changing address (see the README)."
else
    SHOWN_HOST="${PUBLIC_HOST:-YOUR-SERVER-HOSTNAME}"
    note "Frontend on Vercel? Set VITE_API_ORIGIN=https://$SHOWN_HOST there and"
    note "          re-run with --allow-origin https://<your-app>.vercel.app"
fi
