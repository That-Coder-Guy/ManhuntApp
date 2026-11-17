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
export function createMap(container, options = {})
{
    const map = L.map(container, { zoomControl: true, attributionControl: true, ...options });
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
    if (view.bounds) map.fitBounds(view.bounds, { padding: view.padding ?? [32, 32], maxZoom: STREET_ZOOM });
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

/**
 * Make dragging follow the finger on a map turned by CSS (TrackMap rotates
 * its whole map so the way you face is up). Leaflet measures a drag in
 * screen pixels and moves the map by that much in its own, unturned frame,
 * so on a turned map the content slid off at an angle; here each move is
 * turned back by the map's angle first. `getAngle()` is the CSS rotation in
 * degrees. Leaflet's own scale guess is also wrong for a turned container
 * (its bounding box grows), and the map is never scaled, so it's 1.
 */
export function dragFollowsRotation(map, getAngle)
{
    const draggable = map.dragging?._draggable;
    if (!draggable) return;
    const onMove = draggable._onMove;
    draggable._onMove = function (event)
    {
        const angle = (getAngle() * Math.PI) / 180;
        const first = event.touches && event.touches.length === 1 ? event.touches[0] : event;
        if (!angle || !this._startPoint || (event.touches && event.touches.length > 1) || first.clientX === undefined)
        {
            return onMove.call(this, event);
        }
        this._parentScale = { x: 1, y: 1 };
        const dx = first.clientX - this._startPoint.x;
        const dy = first.clientY - this._startPoint.y;
        const cos = Math.cos(-angle);
        const sin = Math.sin(-angle);
        const point = { clientX: this._startPoint.x + dx * cos - dy * sin, clientY: this._startPoint.y + dx * sin + dy * cos };
        // The real event, with the pointer turned (methods still act on it)
        const turned = new Proxy(event, {
            get(target, key)
            {
                if (key === 'clientX' || key === 'clientY') return point[key];
                if (key === 'touches' && target.touches) return [point];
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        return onMove.call(this, turned);
    };
}
