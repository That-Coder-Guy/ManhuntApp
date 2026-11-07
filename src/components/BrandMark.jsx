/**
 * Flat brand glyph: a single compass needle, blaze tip and ink tail, the same
 * object the seeker follows in the game. One solid colour per half, no gloss.
 */
function BrandMark()
{
    return (
        <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <polygon points="12,2 8.5,12 15.5,12" className="brand-mark-tip" />
            <polygon points="12,22 8.5,12 15.5,12" className="brand-mark-tail" />
        </svg>
    );
}

export default BrandMark;
