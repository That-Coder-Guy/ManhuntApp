// What both maps share: OpenStreetMap tiles, the attribution, and framing
// that waits until the map has a size
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// OpenStreetMap's standard tiles: free, no key, attribution required
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const WORLD_VIEW = { center: [20, 0], zoom: 2 };
export const STREET_ZOOM = 17;

export const toLatLng = (p) => [p.latitude, p.longitude];
export const hasPosition = (p) => p?.latitude != null && p?.longitude != null;

/** A Leaflet map in `container` with the street tiles, at a world view */
export function createMap(container)
{
    const map = L.map(container, { zoomControl: true, attributionControl: true });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    map.attributionControl.setPrefix(false);
    // Leaflet needs some view before anything else; the real one follows
    map.setView(WORLD_VIEW.center, WORLD_VIEW.zoom);
    return map;
}

/**
 * Move the map to a view: { bounds } to frame, or { center, zoom }. A map in a
 * sheet that is still opening has no size yet, and fitting then picks the
 * wrong zoom, so the view waits in `pending` (a ref) until the map has a size.
 */
export function showView(map, container, pending, view)
{
    if (!container.clientWidth || !container.clientHeight)
    {
        pending.current = view;
        return;
    }
    pending.current = null;
    if (view.bounds) map.fitBounds(view.bounds, { padding: [32, 32], maxZoom: STREET_ZOOM });
    else map.setView(view.center, view.zoom);
}

/** Keep the map's size in step with its container, applying a pending view */
export function watchSize(map, container, pending)
{
    const resize = new ResizeObserver(() =>
    {
        map.invalidateSize();
        if (pending.current) showView(map, container, pending, pending.current);
    });
    resize.observe(container);
    return () => resize.disconnect();
}
