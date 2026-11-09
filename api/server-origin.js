// GET /api/server-origin → { origin: "https://….trycloudflare.com" | null }
//
// Vercel serves the frontend but can't run the game server, which lives on a
// Raspberry Pi behind a Cloudflare quick tunnel whose address changes when the
// tunnel restarts. The Pi writes its current address into this project's Edge
// Config (scripts/publish-address.mjs); the app asks here when it starts.
import { get } from '@vercel/edge-config';
import { SERVER_ORIGIN_KEY, normalizeServerOrigin } from '../shared/serverOrigin.js';

export default async function handler(_req, res)
{
    let origin = null;
    try {
        // Reads the store named by EDGE_CONFIG, which Vercel sets when the
        // store is connected to the project
        origin = normalizeServerOrigin(await get(SERVER_ORIGIN_KEY));
    } catch (error) {
        console.error('Edge Config read failed:', error.message);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ origin });
}
