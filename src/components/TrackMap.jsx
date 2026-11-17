import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { IonIcon } from '@ionic/react';
import { scanOutline } from 'ionicons/icons';
import { createMap, showView, watchSize, dragFollowsRotation, toLatLng, hasPosition, STREET_ZOOM } from '../utils/leafletBase';
import useCompassHeading from '../hooks/useCompassHeading';
import useSmoothAngle from '../hooks/useSmoothAngle';
import { initials } from '../utils/avatar';
import { playerName, playerFreshness } from '../utils/players';

// Once a marker gets this close to the map's edge (as a share of the view),
// the map reframes so the seeker never loses sight of either end
const EDGE_MARGIN = 0.12;
// Space kept clear around framed markers, in pixels
const FRAME_PADDING = 32;
const NORTH_UP_KEY = 'manhunt.mapNorthUp';

const readNorthUp = () => { try { return localStorage.getItem(NORTH_UP_KEY) === '1'; } catch { return false; } };
const saveNorthUp = (on) => { try { localStorage.setItem(NORTH_UP_KEY, on ? '1' : '0'); } catch { /* not remembered */ } };

/**
 * A hider's pin: initials in a disc, ringed green while their fix is fresh.
 * The tracked hider's pin is larger and carries their name. Built with
 * textContent, never HTML strings: names are typed by players.
 */
function hiderIcon(player, { tracked, fresh })
{
    const root = document.createElement('div');
    const disc = document.createElement('span');
    disc.className = 'track-pin-disc';
    disc.textContent = initials(playerName(player));
    root.appendChild(disc);
    if (tracked)
    {
        const label = document.createElement('span');
        label.className = 'track-pin-label';
        label.textContent = playerName(player);
        root.appendChild(label);
    }
    const size = tracked ? 40 : 30;
    return L.divIcon({
        className: `track-pin${tracked ? ' track-pin--tracked' : ''}${fresh ? '' : ' track-pin--stale'}`,
        html: root,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
    });
}

/**
 * The seeker's street map: you (blaze dot), the hider you're tracking (large
 * labelled pin, dashed line from you), the other hiders (tap one to track
 * them instead) and the play area. It frames you and the hider once, then
 * stays put while you pan and zoom, reframing only if either of you nears
 * the edge; "Fit" frames you both again.
 *
 * Like the compass dial, the map turns with the phone, so the way you face
 * is up (the north button keeps north up instead). The map is drawn on a
 * square big enough to cover the view at any angle, turned with CSS; pins,
 * labels and Leaflet's controls are turned back so they stay upright.
 */
function TrackMap({ you, target, hiders, playArea, onSelect, now })
{
    const wrapRef = useRef(null);
    const containerRef = useRef(null);
    // The visible view and the turned square behind it, in pixels
    const viewRef = useRef({ width: 0, height: 0, side: 0 });

    // Which way the map turns: with the phone, unless north is kept up
    const { heading } = useCompassHeading();
    const [northUp, setNorthUp] = useState(readNorthUp);
    const canTurn = heading !== null;
    const rotationRef = useRef(0);
    useSmoothAngle(canTurn && !northUp ? -heading : 0, (degrees) =>
    {
        rotationRef.current = degrees;
        wrapRef.current?.style.setProperty('--map-rotation', `${degrees}deg`);
    });

    function toggleNorthUp()
    {
        saveNorthUp(!northUp);
        setNorthUp(!northUp);
    }
    const mapRef = useRef(null);
    const layersRef = useRef(null);
    const pendingViewRef = useRef(null);
    // Who moved the map last: until the seeker pans or zooms, it follows both
    const userMovedRef = useRef(false);
    const programmaticRef = useRef(false);
    const programmaticTimerRef = useRef(null);
    const framedTargetRef = useRef(null);
    const [userMoved, setUserMoved] = useState(false);

    const latest = useRef({ onSelect });
    latest.current = { onSelect };

    function frame(force = false)
    {
        const map = mapRef.current;
        if (!map) return;
        const points = [you, target].filter(hasPosition).map(toLatLng);
        if (!points.length) return;

        // The map turns, so what's sure to show at any angle is the circle
        // the view's shorter side spans; frame within that
        const { width, height, side } = viewRef.current;
        const radius = Math.min(width, height) / 2;
        if (!force)
        {
            // Leave a view the seeker chose alone while both still show well
            const centre = map.getSize().divideBy(2);
            const inView = (p) => map.latLngToContainerPoint(p).distanceTo(centre) <= radius * (1 - 2 * EDGE_MARGIN);
            if (userMovedRef.current || points.every(inView)) return;
        }
        // A square inside that circle, with room around the markers
        const box = Math.max(0, (radius - FRAME_PADDING) * Math.SQRT2);
        const padding = side ? Math.max(FRAME_PADDING, (side - box) / 2) : FRAME_PADDING;
        // Our move, not the seeker's. Leaflet fires no moveend when the view
        // doesn't change, so the flag also clears itself
        programmaticRef.current = true;
        clearTimeout(programmaticTimerRef.current);
        programmaticTimerRef.current = setTimeout(() => { programmaticRef.current = false; }, 600);
        const view = points.length === 1
            ? { center: points[0], zoom: Math.max(map.getZoom(), STREET_ZOOM - 1) }
            : { bounds: L.latLngBounds(points), padding: [padding, padding] };
        showView(map, containerRef.current, pendingViewRef, view);
    }

    // Create the map once
    useEffect(() =>
    {
        const container = containerRef.current;
        const wrap = wrapRef.current;
        // Zooming by pinch, wheel or double tap keeps the centre: the turned
        // map can't place a finger's position
        const map = createMap(container, { touchZoom: 'center', scrollWheelZoom: 'center', doubleClickZoom: 'center' });
        dragFollowsRotation(map, () => rotationRef.current);

        // The turned square covers the view at any angle: its side is the
        // view's diagonal, centred on it
        const sizeToView = () =>
        {
            const width = wrap.clientWidth;
            const height = wrap.clientHeight;
            const side = Math.ceil(Math.hypot(width, height));
            viewRef.current = { width, height, side };
            wrap.style.setProperty('--map-side', `${side}px`);
            wrap.style.setProperty('--view-width', `${width}px`);
            wrap.style.setProperty('--view-height', `${height}px`);
            // Whole pixels, or the tiles show hairline seams between them
            wrap.style.setProperty('--inset-x', `${Math.round((side - width) / 2)}px`);
            wrap.style.setProperty('--inset-y', `${Math.round((side - height) / 2)}px`);
        };
        sizeToView();
        const viewWatcher = new ResizeObserver(sizeToView);
        viewWatcher.observe(wrap);
        layersRef.current = {
            area: L.layerGroup().addTo(map),
            line: L.layerGroup().addTo(map),
            hiders: L.layerGroup().addTo(map),
            you: L.layerGroup().addTo(map)
        };
        // Our own fitBounds/setView also fire move events; only the seeker's
        // own drags and zooms count as taking over the view
        const takeOver = () =>
        {
            userMovedRef.current = true;
            setUserMoved(true);
        };
        map.on('movestart zoomstart', () => { if (!programmaticRef.current) takeOver(); });
        map.on('dragstart', takeOver); // a finger on the map is always the seeker
        map.on('moveend', () => { programmaticRef.current = false; });
        const stopWatching = watchSize(map, container, pendingViewRef);
        mapRef.current = map;
        return () =>
        {
            viewWatcher.disconnect();
            stopWatching();
            clearTimeout(programmaticTimerRef.current);
            map.remove();
            mapRef.current = null;
        };
    }, []);

    // The play area, quiet so the tracking line stands out
    useEffect(() =>
    {
        const layer = layersRef.current?.area;
        if (!layer) return;
        layer.clearLayers();
        if (playArea?.length >= 3)
        {
            L.polygon(playArea.map(toLatLng), {
                color: '#8990a2', weight: 1.5, fillColor: '#8990a2', fillOpacity: 0.06, interactive: false
            }).addTo(layer);
        }
    }, [playArea]);

    // Hider pins live as long as their player: each update moves them in
    // place, and an icon is only rebuilt when it changes, so a pin is never
    // swapped out from under a finger reaching for it
    const pinsRef = useRef(new Map()); // player_id → { marker, key }

    useEffect(() =>
    {
        const layers = layersRef.current;
        if (!layers) return;
        const pins = pinsRef.current;
        const seen = new Set();

        for (const hider of hiders)
        {
            if (!hasPosition(hider)) continue;
            seen.add(hider.player_id);
            const tracked = hider.player_id === target.player_id;
            const fresh = playerFreshness(hider, now).fresh;
            const key = `${tracked}|${fresh}|${playerName(hider)}`;
            let pin = pins.get(hider.player_id);
            if (!pin)
            {
                const marker = L.marker(toLatLng(hider), { keyboard: false }).addTo(layers.hiders);
                marker.on('click', () => latest.current.onSelect(hider.player_id));
                pin = { marker, key: null };
                pins.set(hider.player_id, pin);
            }
            pin.marker.setLatLng(toLatLng(hider));
            if (pin.key !== key)
            {
                pin.marker.setIcon(hiderIcon(hider, { tracked, fresh }));
                // The tracked hider sits on top and isn't a button
                pin.marker.setZIndexOffset(tracked ? 1000 : 0);
                pin.marker.getElement()?.setAttribute('title', tracked ? '' : `Track ${playerName(hider)}`);
                pin.marker.getElement()?.classList.toggle('leaflet-interactive', !tracked);
                pin.key = key;
            }
        }
        // Hiders who left, were found, or lost their position
        for (const [id, pin] of pins)
        {
            if (seen.has(id)) continue;
            pin.marker.remove();
            pins.delete(id);
        }

        layers.line.clearLayers();
        if (hasPosition(you) && hasPosition(target))
        {
            L.polyline([toLatLng(you), toLatLng(target)], {
                color: '#ff7b2c', weight: 2, opacity: 0.85, dashArray: '4 7', interactive: false
            }).addTo(layers.line);
        }

        layers.you.clearLayers();
        if (hasPosition(you))
        {
            L.circleMarker(toLatLng(you), {
                radius: 8, weight: 3, color: '#0b0d14', fillColor: '#ff7b2c', fillOpacity: 1, interactive: false
            }).addTo(layers.you);
        }

        // A newly tracked hider gets a fresh frame; otherwise follow gently
        if (framedTargetRef.current !== target.player_id && hasPosition(target))
        {
            framedTargetRef.current = target.player_id;
            userMovedRef.current = false;
            setUserMoved(false);
            frame(true);
        }
        else
        {
            frame(false);
        }
    }, [you?.latitude, you?.longitude, target, hiders, now]); // eslint-disable-line react-hooks/exhaustive-deps

    function fitBoth()
    {
        userMovedRef.current = false;
        setUserMoved(false);
        frame(true);
    }

    return (
        <div ref={wrapRef} className="track-map-wrap">
            <div ref={containerRef} className="play-area-map track-map" data-testid="track-map" />
            {!hasPosition(target) && (
                <p className="track-map-waiting" data-testid="track-map-waiting">Waiting for {playerName(target)}’s position</p>
            )}
            <button
                type="button"
                className={`track-map-fit${userMoved ? ' track-map-fit--active' : ''}`}
                data-testid="track-map-fit"
                onClick={fitBoth}
                aria-label="Show you and the hider"
            >
                <IonIcon icon={scanOutline} aria-hidden="true" />
                Fit
            </button>
            {canTurn && (
                <button
                    type="button"
                    className={`track-map-north${northUp ? ' track-map-north--locked' : ''}`}
                    data-testid="track-map-north"
                    onClick={toggleNorthUp}
                    aria-pressed={northUp}
                    aria-label={northUp ? 'Turn the map with you' : 'Keep north up'}
                >
                    {/* Points north, turning with the map */}
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="track-map-north-needle">
                        <path d="M12 3 L16 12 L8 12 Z" className="track-map-north-tip" />
                        <path d="M12 21 L16 12 L8 12 Z" className="track-map-north-tail" />
                    </svg>
                </button>
            )}
        </div>
    );
}

export default TrackMap;
