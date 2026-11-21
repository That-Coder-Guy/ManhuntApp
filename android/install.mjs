#!/usr/bin/env node
/**
 * Builds the Android app and puts it on the phone (or emulator) connected to
 * this computer. Works on Windows, Linux and macOS.
 *
 *   node android/install.mjs               build Manhunt.apk and install it
 *   node android/install.mjs --build-only  just build android/Manhunt.apk
 *   node android/install.mjs --server <address>
 *                                          the same, showing a different server from
 *                                          the one built in (for trying a test server)
 *
 * The APK can also be sent to a phone and opened there: nothing about it is
 * tied to one phone, and it doesn't expire.
 *
 * One-time setup (Java and the Android SDK) is in README.md.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WINDOWS = process.platform === 'win32';
const buildOnly = process.argv.includes('--build-only');

if (process.argv.includes('--help') || process.argv.includes('-h'))
{
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 15).map((line) => line.replace(/^ \* ?/, '')).join('\n'));
    process.exit(0);
}

function fail(message)
{
    console.error(`\n${message}`);
    process.exit(1);
}

// The app shows the game's own server (app/build.gradle.kts) unless told otherwise
const serverFlag = process.argv.indexOf('--server');
const server = serverFlag === -1 ? null : process.argv[serverFlag + 1];
// (it goes on a command line: nothing but an address gets through)
if (serverFlag !== -1 && !/^(https:\/\/)?[a-z0-9.-]+(:\d+)?\/?$/i.test(server ?? ''))
{
    fail('--server needs an https address, like name.example.com');
}

// ---- The Android SDK ----

const LOCAL_PROPERTIES = join(HERE, 'local.properties');

/** Where the Android SDK is: what Gradle was already told, the usual variables, then the usual places */
function findSdk()
{
    if (existsSync(LOCAL_PROPERTIES))
    {
        const saved = readFileSync(LOCAL_PROPERTIES, 'utf8').match(/^sdk\.dir=(.+)$/m)?.[1]?.trim().replace(/\\(.)/g, '$1');
        if (saved && existsSync(saved)) return saved;
    }
    const places = [
        process.env.ANDROID_HOME,
        process.env.ANDROID_SDK_ROOT,
        join(homedir(), 'Android', 'Sdk'),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
        join(homedir(), 'Library', 'Android', 'sdk')
    ];
    return places.find((place) => place && existsSync(join(place, 'platforms'))) ?? null;
}

const sdk = findSdk();
if (!sdk) fail('The Android SDK wasn\'t found. See android/README.md, "One-time setup", or set ANDROID_HOME to where it is.');
// Forward slashes and an escaped colon: backslashes and colons are special in this file
writeFileSync(LOCAL_PROPERTIES, `sdk.dir=${sdk.replaceAll('\\', '/').replace(':', '\\:')}\n`);

// ---- Build ----

console.log('Building the app...');
// A .bat file only runs through the shell on Windows, as one command line with its path spelled out
const GRADLE_TASK = ['assembleDebug', '--console=plain', '--quiet', ...(server ? [`-Pserver=${server}`] : [])];
if (server) console.log(`Built to show this server instead of the game's own: ${server}`);
const gradle = WINDOWS
    ? spawnSync(`"${join(HERE, 'gradlew.bat')}" ${GRADLE_TASK.join(' ')}`, { cwd: HERE, stdio: 'inherit', shell: true })
    : spawnSync('./gradlew', GRADLE_TASK, { cwd: HERE, stdio: 'inherit' });
if (gradle.status !== 0) fail('The build failed (see above).');

const APK = join(HERE, 'Manhunt.apk');
copyFileSync(join(HERE, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'), APK);
console.log(`Built: ${APK}`);
if (buildOnly) process.exit(0);

// ---- Install ----

const adb = join(sdk, 'platform-tools', WINDOWS ? 'adb.exe' : 'adb');
if (!existsSync(adb)) fail(`adb wasn't found in the SDK (${adb}). Install "platform-tools" with the SDK manager.`);

const listing = spawnSync(adb, ['devices'], { encoding: 'utf8' }).stdout ?? '';
const devices = listing.split('\n').slice(1).map((line) => line.trim().split(/\s+/)).filter(([serial]) => serial);
const ready = devices.filter(([, state]) => state === 'device').map(([serial]) => serial);
const waiting = devices.filter(([, state]) => state === 'unauthorized');

if (ready.length === 0)
{
    fail(waiting.length > 0
        ? 'The phone is connected but hasn\'t allowed this computer yet: unlock it and tap Allow on "Allow USB debugging?", then run this again.'
        : 'No phone found. Plug one in with USB debugging on (android/README.md says how), or send Manhunt.apk to the phone and open it there.');
}

for (const serial of ready)
{
    console.log(`Installing on ${serial}...`);
    const install = spawnSync(adb, ['-s', serial, 'install', '-r', APK], { stdio: 'inherit' });
    if (install.status !== 0) fail(`Couldn't install on ${serial} (see above).`);
}
console.log('\nInstalled. Open Manhunt on the phone.');
