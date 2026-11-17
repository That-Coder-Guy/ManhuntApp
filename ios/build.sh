#!/usr/bin/env bash
#
# Builds the iOS app and puts it on the iPhone plugged into this computer.
# Run it in Linux, or in WSL on Windows (ios\install.cmd does that for you).
#
#   ios/build.sh                      build, sign and install
#   ios/build.sh --server <address>   the same, with the game server's address
#                                     built in, so the app doesn't ask for it
#   ios/build.sh --build-only         just build (no phone or Apple ID needed)
#   ios/build.sh --devices            list the phones xtool can see
#
# One-time setup (xtool, Swift, Xcode.xip, your Apple ID) is in README.md.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER=""
MODE="install"

while [ $# -gt 0 ]; do
    case "$1" in
        --server)     SERVER="${2:?--server needs an address}"; shift 2 ;;
        --build-only) MODE="build"; shift ;;
        --devices)    MODE="devices"; shift ;;
        -h|--help)    sed -n '3,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *)            echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
    esac
done

fail() { echo "$1" >&2; exit 1; }

command -v xtool >/dev/null || fail "xtool isn't installed. See ios/README.md, \"One-time setup\"."

# ---- The phone ----
#
# In WSL the phone is plugged into Windows, not Linux. Windows' Apple Mobile
# Device Service is passed through instead (tools/usbmux-relay.cjs says how).

RELAY_PORT=27015
RELAY_PID=""
RELAY_DIR=""

stop_relay()
{
    if [ -n "$RELAY_PID" ]; then kill "$RELAY_PID" 2>/dev/null || true; fi
    if [ -n "$RELAY_DIR" ]; then rm -rf "$RELAY_DIR"; fi
}
trap stop_relay EXIT

connect_phone()
{
    # Already reachable: a phone attached to Linux itself, or set up by hand
    if [ -n "${USBMUXD_SOCKET_ADDRESS:-}" ] || [ -S /var/run/usbmuxd ]; then return; fi
    grep -qi microsoft /proc/version 2>/dev/null || return 0

    command -v node.exe >/dev/null || fail "Node.js for Windows is needed to reach the phone from WSL (node.exe wasn't found)."
    command -v socat >/dev/null || fail "socat is needed to reach the phone from WSL: sudo apt-get install socat"

    RELAY_DIR="$(mktemp -d)"
    # A wrapper, so socat is handed a path with nothing in it that it treats specially
    {
        echo '#!/usr/bin/env bash'
        printf 'exec node.exe %q\n' "$(wslpath -w "$HERE/tools/usbmux-relay.cjs")"
    } > "$RELAY_DIR/relay"
    chmod +x "$RELAY_DIR/relay"

    socat "TCP-LISTEN:$RELAY_PORT,bind=127.0.0.1,reuseaddr,fork" "EXEC:$RELAY_DIR/relay" &
    RELAY_PID=$!
    export USBMUXD_SOCKET_ADDRESS="127.0.0.1:$RELAY_PORT"
    sleep 0.5
}

if [ "$MODE" = "devices" ]; then
    connect_phone
    exec_status=0
    xtool devices || exec_status=$?
    exit "$exec_status"
fi

# ---- Build ----

command -v swift >/dev/null || fail "Swift isn't installed. See ios/README.md, \"One-time setup\"."
swift sdk list 2>/dev/null | grep -q darwin \
    || fail "The iOS SDK isn't set up yet: run 'xtool setup' and give it Xcode.xip. See ios/README.md, \"One-time setup\"."

# Swift builds are slow and trip over file permissions on a Windows drive, so
# from WSL the sources are copied into Linux's own files and built there
BUILD="$HERE"
case "$HERE" in
    /mnt/*)
        BUILD="${XDG_CACHE_HOME:-$HOME/.cache}/manhunt-ios"
        mkdir -p "$BUILD"
        rsync -a --delete --exclude /.build --exclude /xtool "$HERE/" "$BUILD/"
        ;;
esac

DEFAULT_SERVER="$BUILD/Sources/Manhunt/Resources/default-server.txt"
if [ -n "$SERVER" ]; then
    printf '%s\n' "$SERVER" > "$DEFAULT_SERVER"
    echo "Server address built in: $SERVER"
else
    rm -f "$DEFAULT_SERVER"
fi

cd "$BUILD"

if [ "$MODE" = "build" ]; then
    xtool dev build --configuration release
    echo "Built: $BUILD/xtool/Manhunt.app"
    exit 0
fi

connect_phone
echo "Building, then installing on the phone (unlock it and keep it plugged in)..."
xtool dev run --configuration release
echo
echo "Installed. A free Apple ID signs the app for 7 days: run this again to renew it."
