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

// Every seeker on the map is this one colour (the accent), you included;
// hiders are discs with their initials. So the two sides never look alike
const SEEKER_COLOUR = '#ff7b2c';

/**
 * A hider's pin: initials in a disc, ringed green while their fix is fresh.
 * The tracked hider's pin is larger; it and any pin given a `label` carry a
 * name. Built with textContent, never HTML strings: names are typed by players.
 */
function hiderIcon(player, { tracked, fresh, label = tracked ? playerName(player) : null })
{
    const root = document.createElement('div');
    const disc = document.createElement('span');
    disc.className = 'track-pin-disc';
    disc.textContent = initials(playerName(player));
    root.appendChild(disc);
    if (label)
    {
        const name = document.createElement('span');
        name.className = 'track-pin-label';
        name.textContent = label;
        root.appendChild(name);
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
 * The street map of a game, for either side.
 *
 * A seeker's: you and the other seekers (dots, all one colour), the hider
 * you're tracking (large labelled pin, dashed line from you), the other
 * hiders (tap one to track them instead) and the play area. A hider the
 * server only places to within some distance (slow or still) has that area
 * drawn round their pin. It frames you and the hider once, then stays put
 * while you pan and zoom, reframing only if either of you nears the edge;
 * "Fit" frames you both again.
 *
 * A hider's (`youAre="hider"`, no `target`): you and your fellow hiders, as
 * named pins, and the play area. The others are where the seekers see them,
 * area and all. No seekers: their positions never reach a hider's phone. It
 * frames all of you.
 *
 * Like the compass dial, the map turns with the phone, so the way you face
 * is up (the north button keeps north up instead). The map is drawn on a
 * square big enough to cover the view at any angle, turned with CSS; pins,
 * labels and Leaflet's controls are turned back so they stay upright.
 */
function TrackMap({ you, youAre = 'seeker', self = null, target = null, hiders, seekers = [], playArea, onSelect = null, now })
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
    // The newest frame(), for the size watcher set up with the map
    const frameRef = useRef(null);

    function frame(force = false)
    {
        const map = mapRef.current;
        if (!map) return;
        // You and who you're tracking; with no one to track, everyone shown
        const points = (target ? [you, target] : [you, ...hiders]).filter(hasPosition).map(toLatLng);
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

    frameRef.current = frame;

    // Create the map once
    useEffect(() =>
    {
        const container = containerRef.current;
        const wrap = wrapRef.current;
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
        // Made only now, with the square at its real size: Leaflet measures
        // its container once, and a first framing worked out against the
        // unsized one comes out zoomed far too wide.
        // Zooming by pinch, wheel or double tap keeps the centre: the turned
        // map can't place a finger's position
        const map = createMap(container, { touchZoom: 'center', scrollWheelZoom: 'center', doubleClickZoom: 'center' });
        dragFollowsRotation(map, () => rotationRef.current);

        // The first framing can come before the page has given the map its
        // room; frame again when its size changes, unless the view is one
        // the player chose
        const viewWatcher = new ResizeObserver(() =>
        {
            sizeToView();
            if (!userMovedRef.current) frameRef.current?.(true);
        });
        viewWatcher.observe(wrap);
        layersRef.current = {
            area: L.layerGroup().addTo(map),
            line: L.layerGroup().addTo(map),
            seekers: L.layerGroup().addTo(map),
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
    const pinsRef = useRef(new Map()); // player_id → { marker, key, area }

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
            const tracked = hider.player_id === target?.player_id;
            const fresh = playerFreshness(hider, now).fresh;
            // A pin is a button only where tapping it tracks that hider
            const selectable = !tracked && !!latest.current.onSelect;
            const key = `${tracked}|${fresh}|${selectable}|${playerName(hider)}`;
            let pin = pins.get(hider.player_id);
            if (!pin)
            {
                const marker = L.marker(toLatLng(hider), { keyboard: false }).addTo(layers.hiders);
                marker.on('click', () => latest.current.onSelect?.(hider.player_id));
                pin = { marker, key: null };
                pins.set(hider.player_id, pin);
            }
            pin.marker.setLatLng(toLatLng(hider));
            if (pin.key !== key)
            {
                // With no one tracked (a hider's map) every pin carries its name
                pin.marker.setIcon(hiderIcon(hider, { tracked, fresh, label: tracked || !target ? playerName(hider) : null }));
                // The tracked hider sits on top and isn't a button
                pin.marker.setZIndexOffset(tracked ? 1000 : 0);
                pin.marker.getElement()?.setAttribute('title', selectable ? `Track ${playerName(hider)}` : '');
                pin.marker.getElement()?.setAttribute('data-testid', 'track-pin');
                pin.marker.getElement()?.classList.toggle('leaflet-interactive', selectable);
                pin.key = key;
            }

            // The area a slow or still hider is somewhere in
            if (hider.uncertainty_m > 0)
            {
                const style = tracked
                    ? { color: '#ff7b2c', opacity: 0.7, fillOpacity: 0.1 }
                    : { color: '#a3a9b8', opacity: 0.45, fillOpacity: 0.05 };
                if (!pin.area) pin.area = L.circle(toLatLng(hider), { radius: hider.uncertainty_m, weight: 1.5, interactive: false }).addTo(layers.area);
                pin.area.setLatLng(toLatLng(hider));
                pin.area.setRadius(hider.uncertainty_m);
                pin.area.setStyle(style);
                pin.area.getElement()?.setAttribute('data-testid', 'track-area');
            }
            else if (pin.area)
            {
                pin.area.remove();
                pin.area = null;
            }
        }
        // Hiders who left, were found, or lost their position
        for (const [id, pin] of pins)
        {
            if (seen.has(id)) continue;
            pin.marker.remove();
            pin.area?.remove();
            pins.delete(id);
        }

        layers.line.clearLayers();
        if (hasPosition(you) && hasPosition(target))
        {
            L.polyline([toLatLng(you), toLatLng(target)], {
                color: '#ff7b2c', weight: 2, opacity: 0.85, dashArray: '4 7', interactive: false
            }).addTo(layers.line);
        }

        // The other seekers: the same colour as you, a little smaller
        layers.seekers.clearLayers();
        for (const seeker of seekers)
        {
            if (!hasPosition(seeker)) continue;
            const dot = L.circleMarker(toLatLng(seeker), {
                radius: 6, weight: 2, color: '#0b0d14', fillColor: SEEKER_COLOUR, fillOpacity: 1, className: 'track-seeker'
            }).addTo(layers.seekers);
            dot.bindTooltip(playerName(seeker), { direction: 'top', offset: [0, -6], className: 'track-seeker-name' });
        }

        layers.you.clearLayers();
        if (hasPosition(you) && youAre === 'hider')
        {
            // A hider like the others, named "You"
            L.marker(toLatLng(you), {
                icon: hiderIcon(self ?? { name: 'You' }, { tracked: true, fresh: true, label: 'You' }),
                keyboard: false, interactive: false, zIndexOffset: 1000
            }).addTo(layers.you);
        }
        else if (hasPosition(you))
        {
            L.circleMarker(toLatLng(you), {
                radius: 8, weight: 3, color: '#0b0d14', fillColor: SEEKER_COLOUR, fillOpacity: 1, interactive: false, className: 'track-you'
            }).addTo(layers.you);
        }

        // A newly tracked hider gets a fresh frame; so, with no one tracked,
        // does any change in who there is to show. Otherwise follow gently
        const framing = target
            ? `track:${target.player_id}`
            : `all:${hiders.filter(hasPosition).map((hider) => hider.player_id).join(',')}`;
        if (framedTargetRef.current !== framing && hasPosition(target ?? you))
        {
            framedTargetRef.current = framing;
            userMovedRef.current = false;
            setUserMoved(false);
            frame(true);
        }
        else
        {
            frame(false);
        }
    }, [you?.latitude, you?.longitude, target, hiders, seekers, youAre, now]); // eslint-disable-line react-hooks/exhaustive-deps

    function fitBoth()
    {
        userMovedRef.current = false;
        setUserMoved(false);
        frame(true);
    }

    return (
        <div ref={wrapRef} className="track-map-wrap">
            <div ref={containerRef} className="play-area-map track-map" data-testid="track-map" />
            {target && !hasPosition(target) && (
                <p className="track-map-waiting" data-testid="track-map-waiting">Waiting for {playerName(target)}’s position</p>
            )}
            <button
                type="button"
                className={`track-map-fit${userMoved ? ' track-map-fit--active' : ''}`}
                data-testid="track-map-fit"
                onClick={fitBoth}
                aria-label={target ? 'Show you and the hider' : 'Show everyone'}
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
