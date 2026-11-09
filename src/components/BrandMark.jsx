/**
 * Toolbar brand mark: the app icon (public/icon.svg) at glyph size. The game's
 * bevelled compass needle points at a player's green fix dot; like the
 * favicon, it leaves out the icon's bezel, which vanishes at this size.
 */
function BrandMark()
{
    return (
        // Cropped to the artwork (the favicon's 32×32 tile has margins) so it fills its box
        <svg className="brand-mark" viewBox="5.3 1.1 26 26" aria-hidden="true">
            <g transform="rotate(40 15 17)">
                <polygon points="15,4.5 11.5,17 15,17" className="brand-mark-tip-light" />
                <polygon points="15,4.5 18.5,17 15,17" className="brand-mark-tip-dark" />
                <polygon points="15,29.5 11.5,17 15,17" className="brand-mark-tail-light" />
                <polygon points="15,29.5 18.5,17 15,17" className="brand-mark-tail-dark" />
            </g>
            <circle cx="15" cy="17" r="2.4" className="brand-mark-hub" />
            <circle cx="25.5" cy="5.8" r="3.4" className="brand-mark-dot" />
        </svg>
    );
}

export default BrandMark;
