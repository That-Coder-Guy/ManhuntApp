import { useEffect, useImperativeHandle, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// OpenStreetMap's standard tiles: free, no key, attribution required
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const WORLD_VIEW = { center: [20, 0], zoom: 2 };
const STREET_ZOOM = 17;

const toPoint = (latlng) => ({ latitude: latlng.lat, longitude: latlng.lng });
const toLatLng = (p) => [p.latitude, p.longitude];

// Touch-sized handles drawn in CSS (.pa-vertex, .pa-midpoint), no image assets
const vertexIcon = (n, editable) => L.divIcon({
    className: `pa-vertex${editable ? ' pa-vertex--editable' : ''}`,
    html: `<span>${n}</span>`,
    iconSize: editable ? [32, 32] : [20, 20]
});
const midpointIcon = L.divIcon({ className: 'pa-midpoint', html: '<span></span>', iconSize: [28, 28] });

const boundsOf = (latlngs) => ({ bounds: L.latLngBounds(latlngs) });

/**
 * Move the map to a view: { bounds } to frame, or { center, zoom }. A map in a
 * sheet that is still opening has no size yet, and fitting then picks the
 * wrong zoom, so the view waits in `pending` until the map has a size.
 */
function showView(map, container, pending, view)
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

/**
 * A map showing the play area polygon. With `editable`, the host builds it:
 * tap the map to add a corner, drag a corner to move it, tap a corner to
 * remove it, or tap the hollow handle between two corners to add one there.
 * `you` is the viewer's own position.
 *
 * `ref` exposes centreOn(point) and showArea() for the buttons around it.
 */
function PlayAreaMap({ ref, points, onChange, editable = false, you = null, maxCorners = 30 })
{
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const shapeLayerRef = useRef(null);
    const youMarkerRef = useRef(null);
    const hasViewRef = useRef(false);
    const hasFramedYouRef = useRef(false);
    const pendingViewRef = useRef(null);

    // Latest props for Leaflet's long-lived event handlers
    const latest = useRef({ points, onChange, editable, maxCorners });
    latest.current = { points, onChange, editable, maxCorners };

    useImperativeHandle(ref, () => ({
        centreOn(point)
        {
            if (!point || !mapRef.current) return;
            showView(mapRef.current, containerRef.current, pendingViewRef, { center: toLatLng(point), zoom: STREET_ZOOM });
        },
        showArea()
        {
            const current = latest.current.points;
            if (!mapRef.current || !current.length) return;
            showView(mapRef.current, containerRef.current, pendingViewRef, boundsOf(current.map(toLatLng)));
        }
    }), []);

    // Create the map once
    useEffect(() =>
    {
        const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
        L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
        map.attributionControl.setPrefix(false);
        shapeLayerRef.current = L.layerGroup().addTo(map);

        map.on('click', (event) =>
        {
            const { points: current, onChange: change, editable: canEdit, maxCorners: max } = latest.current;
            if (!canEdit || current.length >= max) return;
            change([...current, toPoint(event.latlng)]);
        });

        // Leaflet needs some view before anything else; the real one follows
        map.setView(WORLD_VIEW.center, WORLD_VIEW.zoom);
        const container = containerRef.current;

        // Opening point: the area if there is one, else the world until we know where you are
        if (latest.current.points.length)
        {
            showView(map, container, pendingViewRef, boundsOf(latest.current.points.map(toLatLng)));
            hasViewRef.current = true;
        }

        // The sheet animates in, so the container's size settles after mount;
        // a view chosen before then is applied once it has one
        const resize = new ResizeObserver(() =>
        {
            map.invalidateSize();
            if (pendingViewRef.current) showView(map, container, pendingViewRef, pendingViewRef.current);
        });
        resize.observe(container);

        mapRef.current = map;
        return () =>
        {
            resize.disconnect();
            map.remove();
            mapRef.current = null;
        };
    }, []);

    // Your position; the first fix centres an empty map on you
    useEffect(() =>
    {
        const map = mapRef.current;
        if (!map || you?.latitude == null) return;

        if (!youMarkerRef.current)
        {
            youMarkerRef.current = L.circleMarker(toLatLng(you), {
                radius: 7, weight: 3, color: '#0b0d14', fillColor: '#4cc38a', fillOpacity: 1, interactive: false
            }).addTo(map);
        }
        else
        {
            youMarkerRef.current.setLatLng(toLatLng(you));
        }

        const container = containerRef.current;
        if (!hasViewRef.current)
        {
            showView(map, container, pendingViewRef, { center: toLatLng(you), zoom: STREET_ZOOM });
            hasViewRef.current = true;
        }
        else if (!latest.current.editable && !hasFramedYouRef.current && latest.current.points.length)
        {
            // Viewing mid-game: frame the area and you together, so someone
            // outside it sees which way it lies
            showView(map, container, pendingViewRef, boundsOf([...latest.current.points.map(toLatLng), toLatLng(you)]));
        }
        hasFramedYouRef.current = true;
    }, [you?.latitude, you?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

    // The polygon and its handles, redrawn whenever the corners change
    useEffect(() =>
    {
        const layer = shapeLayerRef.current;
        if (!layer) return;
        layer.clearLayers();
        if (!points.length) return;

        const style = { color: '#ff7b2c', weight: 2, fillColor: '#ff7b2c', fillOpacity: 0.12, interactive: false };
        const latlngs = points.map(toLatLng);
        const shape = points.length >= 3
            ? L.polygon(latlngs, style)
            : L.polyline(latlngs, { ...style, dashArray: '6 6' });
        shape.addTo(layer);

        points.forEach((point, index) =>
        {
            const marker = L.marker(toLatLng(point), {
                icon: vertexIcon(index + 1, editable),
                draggable: editable,
                keyboard: false,
                interactive: editable,
                title: editable ? `Corner ${index + 1}: drag to move, tap to remove` : `Corner ${index + 1}`
            }).addTo(layer);

            if (!editable) return;

            // Reshape live while dragging; commit when the finger lifts
            marker.on('drag', () =>
            {
                const moved = [...latlngs];
                moved[index] = marker.getLatLng();
                shape.setLatLngs(moved);
            });
            marker.on('dragend', () =>
            {
                const next = [...latest.current.points];
                next[index] = toPoint(marker.getLatLng());
                latest.current.onChange(next);
            });
            marker.on('click', () => latest.current.onChange(latest.current.points.filter((_, i) => i !== index)));
        });

        // Hollow handles halfway along each edge add a corner there
        if (editable && points.length >= 2 && points.length < maxCorners)
        {
            const edges = points.length >= 3 ? points.length : 1;
            for (let index = 0; index < edges; index++)
            {
                const a = points[index];
                const b = points[(index + 1) % points.length];
                const middle = { latitude: (a.latitude + b.latitude) / 2, longitude: (a.longitude + b.longitude) / 2 };
                L.marker(toLatLng(middle), { icon: midpointIcon, keyboard: false, title: 'Add a corner here' })
                    .on('click', () =>
                    {
                        const next = [...latest.current.points];
                        next.splice(index + 1, 0, middle);
                        latest.current.onChange(next);
                    })
                    .addTo(layer);
            }
        }
    }, [points, editable, maxCorners]);

    return <div ref={containerRef} className="play-area-map" data-testid="play-area-map" />;
}

export default PlayAreaMap;
