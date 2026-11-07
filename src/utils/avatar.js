// Profile pictures are tiny square JPEGs sent as data URLs. The server caps
// them at 40,000 characters, so shrink until one fits.
const SIZE_PX = 96;
const MAX_CHARS = 38_000;
const QUALITIES = [0.85, 0.7, 0.55, 0.4];

function loadImage(file)
{
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That picture couldn't be opened. Try a JPEG or PNG.")); };
        image.src = url;
    });
}

/** Centre-crop an image file to a small square and return a JPEG data URL */
export async function fileToAvatar(file)
{
    if (!file || !file.type.startsWith('image/')) throw new Error('Choose a picture file');

    const image = await loadImage(file);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error("That picture couldn't be opened. Try a JPEG or PNG.");

    const canvas = document.createElement('canvas');
    canvas.width = SIZE_PX;
    canvas.height = SIZE_PX;
    const context = canvas.getContext('2d');
    context.drawImage(
        image,
        (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side,
        0, 0, SIZE_PX, SIZE_PX
    );

    for (const quality of QUALITIES)
    {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (dataUrl.length <= MAX_CHARS) return dataUrl;
    }
    throw new Error('That picture is too detailed to use. Try another one.');
}

/** Up to two initials for a placeholder avatar */
export function initials(name)
{
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[words.length - 1]][0]];
    return letters.join('').toUpperCase();
}
