// Pictures in the chat. A photo straight off a phone is several megabytes;
// before it's sent it is shrunk and compressed here to about 60 KB, so it
// costs everyone in the lobby next to nothing to receive.
//
// The format is WebP where the browser can make one (Chrome, Firefox, newer
// Safari), which is a quarter to a third smaller than a JPEG that looks the
// same, and JPEG everywhere else. JPEG XL and AVIF would be smaller still,
// but no browser can make either without a large encoder shipped with the
// app, and Chrome and Android can't show JPEG XL at all.

// Mirrors the server's limit (server/game.js)
export const CHAT_IMAGE_MAX_BYTES = 72_000;
// What to aim for: under the limit, with room to spare
const TARGET_BYTES = 60_000;
// The longer side, in pixels, to start from: plenty for a phone held upright
export const CHAT_IMAGE_MAX_SIDE = 1280;
// If the lowest quality is still too big, the picture is made smaller, down to this
const MIN_SIDE = 320;
const SHRINK = 0.8;
const QUALITIES = [0.6, 0.45, 0.3];
const TYPES = ['image/webp', 'image/jpeg'];

const UNREADABLE = "That picture couldn't be opened. Try a JPEG or PNG.";

/** The size a picture is drawn at: its own shape, with the longer side no more than `maxSide` */
export function fitWithin(width, height, maxSide)
{
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** "48 KB": a size in bytes, for people */
export function formatBytes(bytes)
{
    return bytes < 1000 ? `${bytes} B` : `${Math.round(bytes / 1000)} KB`;
}

function loadImage(file)
{
    return new Promise((resolve, reject) =>
    {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(UNREADABLE)); };
        image.src = url;
    });
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Shrink and compress a picture file for the chat. Resolves with
 * { blob, type, width, height }; rejects with a message for the player if
 * the file isn't a picture this browser can open.
 */
export async function compressChatImage(file)
{
    if (!file || !file.type.startsWith('image/')) throw new Error('Choose a picture file');
    const image = await loadImage(file);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error(UNREADABLE);

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    // The first type this browser really makes: asked for one it can't, it hands back a PNG
    let type = null;
    let smallest = null;

    for (let side = CHAT_IMAGE_MAX_SIDE; ; side = Math.round(side * SHRINK))
    {
        const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, side);
        canvas.width = width;
        canvas.height = height;
        // White behind see-through pictures: a JPEG would make it black
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);

        for (const quality of QUALITIES)
        {
            let blob = null;
            for (const candidate of type ? [type] : TYPES)
            {
                blob = await toBlob(canvas, candidate, quality);
                if (blob?.type === candidate) { type = candidate; break; }
                blob = null;
            }
            if (!blob) throw new Error("This browser can't prepare pictures for the chat.");
            if (!smallest || blob.size < smallest.blob.size) smallest = { blob, type, width, height };
            if (blob.size <= TARGET_BYTES) return smallest;
        }
        if (Math.max(width, height) <= MIN_SIDE) break;
    }

    if (smallest.blob.size <= CHAT_IMAGE_MAX_BYTES) return smallest;
    throw new Error('That picture is too detailed to send. Try another one.');
}
