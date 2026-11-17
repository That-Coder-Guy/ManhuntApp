/* global __APP_VERSION__ */
// This app's version, baked in at build time from git (see shared/version.js)
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined'
    ? __APP_VERSION__
    : { build: null, commit: 'unknown', date: null };

/** "Version 60 · cb64839 · Nov 17, 2026", leaving out whatever is unknown */
export function formatVersion(version, { withDate = true } = {})
{
    if (!version) return '';
    const parts = [version.build ? `Version ${version.build}` : 'Version', version.commit];
    if (withDate && version.date)
    {
        const date = new Date(version.date);
        if (!Number.isNaN(date.getTime()))
        {
            parts.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
        }
    }
    return parts.join(' · ');
}

/** True when two versions are known to be different updates */
export function isDifferentVersion(a, b)
{
    const known = (v) => Boolean(v?.commit) && v.commit !== 'unknown';
    return known(a) && known(b) && a.commit !== b.commit;
}
