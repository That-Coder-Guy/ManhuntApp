// The simulator's own page: makes a lobby, puts each phone in a frame, moves
// them about, and draws where they really are. What happens inside a phone
// is phone.mjs.

const NAMES = ['Hank', 'Maya', 'Priya', 'Theo'];
const SCREEN = { width: 390, height: 844 };
// Changed from the game's defaults, so a jam can be tried without a 15 minute wait
const SETTINGS = { jam_charge_s: 30 };
const AREA_M = 350;          // nobody walks further than this from the middle
const TICK_MS = 1000;
const METRES_PER_DEGREE = 111_320;
const COLOUR = { seeker: '#ff7b2c', hider: '#3ecf8e', line: '#262b3a', muted: '#8b91a5', text: '#e8eaf1' };

const $ = (id) => document.getElementById(id);
const random = (from, to) => from + Math.random() * (to - from);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const query = new URLSearchParams(window.location.search);
const numberFrom = (name, fallback) => (query.has(name) && Number.isFinite(Number(query.get(name))) ? Number(query.get(name)) : fallback);
// The middle of the play: ?lat=..&lng=.. to move it
const CENTRE = { latitude: clamp(numberFrom('lat', 39.19), -85, 85), longitude: clamp(numberFrom('lng', -96.58), -180, 180) };

let count = clamp(Math.round(numberFrom('phones', 4)), 1, NAMES.length);
let seekers = clamp(Math.round(numberFrom('seekers', 1)), 1, Math.max(1, count - 1));
let phones = [];
let paused = false;
let game = 0; // counts games, so an answer for an old one is dropped
let lobbyId = null;

// ---- What the phones keep (phone.mjs: "sim:<lobby>:<phone>:…" in localStorage) ----

const KEPT_FOR_MS = 24 * 60 * 60 * 1000;

function forgetLobby(id)
{
    try {
        Object.keys(localStorage).filter((key) => key.startsWith(`sim:${id}:`)).forEach((key) => localStorage.removeItem(key));
    } catch { /* storage unavailable: nothing was kept */ }
}

// Games from tabs that were closed, once they're a day old
function forgetOldGames()
{
    try {
        for (const key of Object.keys(localStorage))
        {
            const made = /^sim:([^:]+):\d+:sim\.made$/.exec(key);
            if (made && Date.now() - Number(localStorage.getItem(key)) > KEPT_FOR_MS) forgetLobby(made[1]);
        }
    } catch { /* storage unavailable */ }
}

// ---- Movement: stand, walk or run, turning a little each second ----

const MODES = [
    { name: 'still', chance: 0.3, seconds: [20, 60], speed: [0, 0], turn: 0 },
    { name: 'walk', chance: 0.55, seconds: [20, 60], speed: [1.0, 1.7], turn: 22 },
    { name: 'run', chance: 0.15, seconds: [8, 25], speed: [2.6, 3.6], turn: 10 }
];

function pickMode(phone, { moving = false } = {})
{
    const modes = moving ? MODES.filter((mode) => mode.name !== 'still') : MODES;
    let roll = Math.random() * modes.reduce((sum, mode) => sum + mode.chance, 0);
    const mode = modes.find((candidate) => (roll -= candidate.chance) < 0) ?? modes[modes.length - 1];
    phone.mode = mode;
    phone.speed = random(...mode.speed);
    phone.secondsLeft = random(...mode.seconds);
}

const toCoordinates = ({ east, north }) => ({
    latitude: CENTRE.latitude + north / METRES_PER_DEGREE,
    longitude: CENTRE.longitude + east / (METRES_PER_DEGREE * Math.cos(CENTRE.latitude * Math.PI / 180))
});

function step(phone, seconds)
{
    phone.secondsLeft -= seconds;
    if (phone.secondsLeft <= 0) pickMode(phone);

    if (phone.speed > 0)
    {
        phone.heading += random(-phone.mode.turn, phone.mode.turn);
        // At the edge: turn back towards the middle
        if (Math.hypot(phone.east, phone.north) > AREA_M)
        {
            phone.heading = Math.atan2(-phone.east, -phone.north) * 180 / Math.PI + random(-40, 40);
        }
        phone.heading = (phone.heading + 360) % 360;
        const radians = phone.heading * Math.PI / 180;
        phone.east += Math.sin(radians) * phone.speed * seconds;
        phone.north += Math.cos(radians) * phone.speed * seconds;
    }
}

function send(phone)
{
    phone.frame?.contentWindow?.postMessage({
        simulator: 'position',
        ...toCoordinates(phone),
        heading: phone.heading,
        speed: paused ? 0 : phone.speed
    }, window.location.origin);
}

// ---- The phones ----

function makePhone(index, lobby)
{
    const seeker = index < seekers;
    // Seekers start together in the middle; hiders spread out around them,
    // further off than the range a hider can be found at
    const hiderNumber = index - seekers;
    const bearing = seeker ? random(0, 360) : (hiderNumber * 360 / Math.max(1, count - seekers)) + random(-25, 25);
    const distance = seeker ? random(0, 25) : random(130, 260);
    const radians = bearing * Math.PI / 180;
    const phone = {
        number: index + 1,
        name: NAMES[index],
        seeker,
        host: index === 0,
        status: null,
        east: Math.sin(radians) * distance,
        north: Math.cos(radians) * distance,
        heading: random(0, 360)
    };
    // Everyone sets off moving: a game that opens with four people standing still shows nothing
    pickMode(phone, { moving: true });

    phone.config = {
        simulator: true,
        phone: phone.number,
        lobby: lobby.lobby_id,
        hostKey: phone.host ? lobby.host_key : null,
        name: phone.name,
        seeker,
        // The host's phone starts the game; one phone alone can't play
        start: phone.host && count > 1,
        names: NAMES.slice(0, count),
        seekers,
        settings: SETTINGS
    };
    return phone;
}

function drawPhone(phone)
{
    const element = document.createElement('div');
    element.className = 'phone';
    element.innerHTML = `
        <div class="caption">
            <span class="dot"></span>
            <span class="who"></span>
            <span class="what"></span>
            <button type="button" title="Reload this phone, as if its browser had been closed and opened again">Reload</button>
        </div>
        <div class="screen"></div>`;
    element.querySelector('.who').textContent = phone.name;

    const frame = document.createElement('iframe');
    frame.title = `${phone.name}’s phone`;
    // The phone's part in the game travels in the frame's name (phone.mjs reads it)
    frame.name = JSON.stringify(phone.config);
    frame.allow = 'clipboard-write';
    frame.src = `/lobby/${phone.config.lobby}`;
    element.querySelector('.screen').append(frame);
    element.querySelector('button').addEventListener('click', () => frame.contentWindow.location.reload());

    phone.frame = frame;
    phone.element = element;
    return element;
}

const sideOf = (phone) => (phone.status?.seeker ?? phone.seeker ? 'seeker' : 'hider');

function describe(phone)
{
    const status = phone.status;
    if (!status?.joined) return 'joining…';
    const side = status.seeker ? 'Seeker' : 'Hider';
    return status.host ? `${side} · host` : side;
}

function refreshCaptions()
{
    for (const phone of phones)
    {
        phone.element.querySelector('.dot').style.background = COLOUR[sideOf(phone)];
        phone.element.querySelector('.what').textContent = describe(phone);
    }

    const host = phones.find((phone) => phone.status?.host) ?? phones[0];
    const phase = host?.status?.phase;
    $('status').textContent = !phones.length ? ''
        : phones.some((phone) => !phone.status?.joined) ? 'The phones are joining…'
        : phase === 'playing' ? 'Game on'
        : phase === 'ended' ? 'Game over · “New game” starts another'
        : count === 1 ? 'One phone can’t play: a game needs a seeker and a hider'
        : 'In the lobby';
}

// Fit the phones into the space there is, in one row or two
function layout()
{
    const stage = $('phones');
    const style = getComputedStyle(stage);
    const gap = parseFloat(style.columnGap) || 0;
    const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    // The window below the bar, whether the side panel is beside the phones or (narrow windows) under them
    const height = window.innerHeight - document.querySelector('.bar').offsetHeight
        - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const caption = 32;

    let best = { scale: 0, columns: count };
    for (let rows = 1; rows <= Math.min(2, count); rows++)
    {
        const columns = Math.ceil(count / rows);
        const scale = Math.min(
            (width - gap * (columns - 1)) / (columns * SCREEN.width),
            (height - rows * caption - gap * (rows - 1)) / (rows * SCREEN.height),
            1
        );
        if (scale > best.scale) best = { scale, columns };
    }
    stage.style.setProperty('--scale', String(Math.max(0.3, best.scale)));
    stage.style.setProperty('--cols', String(best.columns));
}

// ---- Where everyone really is ----

function drawTruth()
{
    const canvas = $('truth');
    const size = canvas.width;
    const context = canvas.getContext('2d');
    const middle = size / 2;
    const scale = (middle - 16) / (AREA_M + 50); // pixels per metre
    context.clearRect(0, 0, size, size);

    context.lineWidth = 1.5;
    context.font = '500 18px system-ui, sans-serif';
    context.textBaseline = 'middle';
    for (let metres = 100; metres <= AREA_M + 50; metres += 100)
    {
        context.strokeStyle = COLOUR.line;
        context.beginPath();
        context.arc(middle, middle, metres * scale, 0, Math.PI * 2);
        context.stroke();
    }
    context.fillStyle = COLOUR.muted;
    context.textAlign = 'center';
    context.fillText('N', middle, 14);

    for (const phone of phones)
    {
        const x = middle + phone.east * scale;
        const y = middle - phone.north * scale;
        const colour = COLOUR[sideOf(phone)];
        const moving = !paused && phone.speed > 0;
        const radians = phone.heading * Math.PI / 180;

        // Which way it's walking
        if (moving)
        {
            context.strokeStyle = colour;
            context.lineWidth = 3;
            context.beginPath();
            context.moveTo(x, y);
            context.lineTo(x + Math.sin(radians) * 26, y - Math.cos(radians) * 26);
            context.stroke();
        }
        context.fillStyle = colour;
        context.beginPath();
        context.arc(x, y, 9, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = COLOUR.text;
        // The name goes on the side it isn't walking towards, and stays inside the picture
        const left = x > size - 90 || (x > 90 && moving && Math.sin(radians) > 0);
        context.textAlign = left ? 'right' : 'left';
        context.fillText(phone.name, x + (left ? -15 : 15), y);
    }
}

function nearestSeeker(phone)
{
    const others = phones.filter((other) => other !== phone && sideOf(other) === 'seeker');
    if (!others.length) return null;
    return Math.min(...others.map((other) => Math.hypot(other.east - phone.east, other.north - phone.north)));
}

function refreshWalkers()
{
    const list = $('walkers');
    if (list.children.length !== phones.length)
    {
        list.replaceChildren(...phones.map(() =>
        {
            const item = document.createElement('li');
            item.innerHTML = '<span class="dot"></span><span class="name"></span><span class="doing"></span>';
            return item;
        }));
    }
    phones.forEach((phone, index) =>
    {
        const item = list.children[index];
        const moving = paused || phone.speed === 0 ? 'standing still'
            : `${phone.mode.name === 'run' ? 'running' : 'walking'} ${phone.speed.toFixed(1)} m/s`;
        const seeker = sideOf(phone) === 'hider' ? nearestSeeker(phone) : null;
        item.querySelector('.dot').style.background = COLOUR[sideOf(phone)];
        item.querySelector('.name').textContent = phone.name;
        item.querySelector('.doing').textContent = seeker === null ? moving : `${moving} · ${Math.round(seeker)} m from a seeker`;
    });
}

// ---- Running it ----

function tick()
{
    for (const phone of phones)
    {
        if (!paused) step(phone, TICK_MS / 1000);
        // Sent even when nothing moved: a phone reports where it is all the time
        send(phone);
    }
    drawTruth();
    refreshWalkers();
}

window.addEventListener('message', (event) =>
{
    if (event.origin !== window.location.origin) return;
    const phone = phones.find((candidate) => candidate.frame?.contentWindow === event.source);
    const message = event.data;
    if (!phone || !message) return;
    // A phone that has just loaded: tell it where it is straight away
    if (message.simulator === 'hello') send(phone);
    if (message.simulator === 'status')
    {
        phone.status = message;
        refreshCaptions();
    }
});

function fillSeekers()
{
    const most = Math.max(1, count - 1);
    seekers = clamp(seekers, 1, most);
    $('seekers').replaceChildren(...Array.from({ length: most }, (_, index) => new Option(String(index + 1))));
    $('seekers').value = String(seekers);
    $('seekers').disabled = count === 1;
}

async function newGame()
{
    const mine = ++game;
    const address = new URL(window.location.href);
    address.searchParams.set('phones', String(count));
    address.searchParams.set('seekers', String(seekers));
    window.history.replaceState(null, '', address);

    phones = [];
    $('phones').replaceChildren();
    $('status').textContent = 'Making a lobby…';
    // The game being replaced: its phones are gone, and so is what they kept
    if (lobbyId) forgetLobby(lobbyId);
    lobbyId = null;

    let lobby = null;
    try {
        const response = await fetch('/manhunt-api/create-lobby', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lobby_name: 'Simulator' })
        });
        lobby = response.ok ? await response.json() : null;
    } catch { /* said below */ }
    if (mine !== game) return;
    if (typeof lobby?.lobby_id !== 'string')
    {
        $('status').textContent = 'Couldn’t make a lobby. Is the simulator still running in the terminal?';
        return;
    }

    lobbyId = lobby.lobby_id;
    phones = Array.from({ length: count }, (_, index) => makePhone(index, lobby));
    layout();
    $('phones').append(...phones.map(drawPhone));
    refreshCaptions();
    tick();
}

$('count').value = String(count);
fillSeekers();
$('count').addEventListener('change', () =>
{
    count = Number($('count').value);
    fillSeekers();
    newGame();
});
$('seekers').addEventListener('change', () =>
{
    seekers = Number($('seekers').value);
    newGame();
});
$('new-game').addEventListener('click', newGame);
$('pause').addEventListener('click', () =>
{
    paused = !paused;
    $('pause').textContent = paused ? 'Resume movement' : 'Pause movement';
    $('pause').setAttribute('aria-pressed', String(paused));
    tick();
});
window.addEventListener('resize', layout);

// A service worker left by the app itself on this address would serve the
// phones a page without their script
if (navigator.serviceWorker)
{
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(registrations.map((registration) => registration.unregister()));
}

forgetOldGames();
setInterval(tick, TICK_MS);
newGame();
