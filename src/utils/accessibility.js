// Accessibility settings (the Settings page): text size and motion. Kept on
// this phone and applied to the whole app from the root element, where
// index.css reads them: --ui-scale sizes everything, and .reduce-motion
// stills what moves.
import { useSyncExternalStore } from 'react';

const TEXT_SIZE_KEY = 'manhunt.textSize';
const REDUCE_MOTION_KEY = 'manhunt.reduceMotion';

/** Text sizes, as what --ui-scale becomes (1 is the design's own size) */
export const TEXT_SIZES = Object.freeze({ default: 1, large: 1.125, larger: 1.25 });

const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* not remembered */ } };

const listeners = new Set();
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

/** 'default' | 'large' | 'larger' */
export function getTextSize()
{
    const saved = read(TEXT_SIZE_KEY);
    return Object.hasOwn(TEXT_SIZES, saved) ? saved : 'default';
}

/**
 * Whether to still what moves: the player's choice here, or the phone's own
 * "reduce motion" setting until they make one
 */
export function getReduceMotion()
{
    const saved = read(REDUCE_MOTION_KEY);
    if (saved === 'on') return true;
    if (saved === 'off') return false;
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function apply()
{
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const scale = TEXT_SIZES[getTextSize()];
    // The default leaves the stylesheet's own value in charge
    if (scale === 1) root.style.removeProperty('--ui-scale');
    else root.style.setProperty('--ui-scale', String(scale));
    root.classList.toggle('reduce-motion', getReduceMotion());
}

function changed()
{
    apply();
    listeners.forEach((listener) => listener());
}

export function setTextSize(size)
{
    if (!Object.hasOwn(TEXT_SIZES, size)) return;
    write(TEXT_SIZE_KEY, size);
    changed();
}

export function setReduceMotion(on)
{
    write(REDUCE_MOTION_KEY, on ? 'on' : 'off');
    changed();
}

/** Apply the saved settings (once, at start-up, before anything is drawn) */
export function initAccessibility()
{
    apply();
}

/** Run `listener` whenever a setting changes; returns a function that stops it */
export const onAccessibilityChange = subscribe;

/** [size, setSize] */
export function useTextSize()
{
    return [useSyncExternalStore(subscribe, getTextSize, () => 'default'), setTextSize];
}

/** [on, setOn] */
export function useReduceMotion()
{
    return [useSyncExternalStore(subscribe, getReduceMotion, () => false), setReduceMotion];
}
