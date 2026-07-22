// CORS origin policy, split out so it can be unit-tested without importing the
// server (which would start listening on a port).

const BASE_ALLOWED_ORIGINS = [
    "https://people.cs.ksu.edu",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
];

// Hostnames of common tunnelling services. Auto-allowing these lets `npm run
// tunnel` work with a fresh, random ngrok URL without editing config. It's
// low-risk for a casual game (joining still requires a live lobby ID / token),
// and the server is meant to be tunnelled ad hoc. Set TRUST_ALL_ORIGINS=1 to
// disable origin checks entirely.
const TUNNEL_HOST_SUFFIXES = [
    ".ngrok-free.app",
    ".ngrok.app",
    ".ngrok-free.dev",
    ".ngrok.io",
    ".trycloudflare.com"
];

// Read from the environment each call so tests (and runtime) can vary it
function extraAllowedOrigins()
{
    return (process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
}

function isAllowedOrigin(origin)
{
    // No Origin header: same-origin navigations and non-browser clients
    if (!origin) return true;

    if (process.env.TRUST_ALL_ORIGINS === "1" || process.env.TRUST_ALL_ORIGINS === "true") {
        return true;
    }

    if (BASE_ALLOWED_ORIGINS.includes(origin)) return true;
    if (extraAllowedOrigins().includes(origin)) return true;

    let hostname;
    try {
        hostname = new URL(origin).hostname;
    } catch {
        return false;
    }

    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    // Private-network addresses (RFC 1918) and mDNS names, so devices on the
    // same LAN can use the dev servers directly
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) return true;
    if (hostname.endsWith(".local")) return true;
    if (TUNNEL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;

    return false;
}

module.exports = { isAllowedOrigin, BASE_ALLOWED_ORIGINS, TUNNEL_HOST_SUFFIXES };
