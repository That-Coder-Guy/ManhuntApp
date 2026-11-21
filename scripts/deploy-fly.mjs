#!/usr/bin/env node
/**
 * Put the app on Fly.io, or update it there: one small always-on machine at
 * https://<app>.fly.dev, an address that never changes.
 *
 *   npm run deploy:fly -- --app your-name     the first time: your-name is the address
 *   npm run deploy:fly                        every update after that
 *
 * It
 *   1. checks the Fly.io CLI is installed and logged in,
 *   2. creates the app if the account doesn't have it yet,
 *   3. gives it the keys that sign push notifications, once (as Fly secrets:
 *      they must outlive every deploy, and a machine's own disk doesn't),
 *   4. builds the image on Fly's builders and deploys it, as a single machine
 *      (games live in its memory: two machines would be two separate servers),
 *      passing in the version, which the image has no git checkout to read,
 *   5. prints the address.
 *
 * Deploying restarts the server, which ends games in progress: do it between
 * rounds. Needs the Fly.io CLI (https://fly.io/docs/flyctl/install/) and an
 * account (`fly auth signup`, or `fly auth login`).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVersion } from '../shared/version.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'fly.toml');
const PLACEHOLDER = 'manhunt-choose-a-name';
const APP_LINE = /^app\s*=\s*"([^"]*)"/m;
// What Fly.io allows in a name, which is also a hostname
const VALID_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const step = (text) => console.log(`\n▸ ${text}`);
function die(...lines)
{
    console.error(`\n✖ ${lines.join('\n  ')}\n`);
    process.exit(1);
}

// The CLI installs as `fly`; older set-ups only have its long name
const FLY = ['fly', 'flyctl'].find((name) => !spawnSync(name, ['version'], { stdio: 'ignore' }).error) || 'fly';

/** Run the Fly.io CLI. `quiet` keeps its output (returned) off the terminal */
function fly(args, { quiet = false, input } = {})
{
    const result = spawnSync(FLY, args, {
        cwd: ROOT,
        encoding: 'utf8',
        input,
        stdio: quiet ? ['pipe', 'pipe', 'pipe'] : [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit']
    });
    return { ok: !result.error && result.status === 0, missing: Boolean(result.error), output: `${result.stdout || ''}${result.stderr || ''}` };
}

/** The app's name: --app's, else the one fly.toml has. `keep()` writes it to fly.toml */
function appName()
{
    const args = process.argv.slice(2);
    const flag = args.indexOf('--app');
    const config = readFileSync(CONFIG, 'utf8');
    const saved = APP_LINE.exec(config)?.[1];
    if (!saved) die('fly.toml has no app = "…" line.');

    if (flag === -1)
    {
        if (saved === PLACEHOLDER) die('This app has no name on Fly.io yet. Choose one (it becomes the address):', 'npm run deploy:fly -- --app your-name');
        return { app: saved, keep() {} };
    }
    const app = args[flag + 1];
    if (!app || !VALID_NAME.test(app)) die('A name is lowercase letters, digits and hyphens, like "manhunt-smith".');
    return {
        app,
        keep()
        {
            if (app === saved) return;
            writeFileSync(CONFIG, config.replace(APP_LINE, `app = "${app}"`));
            console.log(`  fly.toml now names the app "${app}" (commit that change).`);
        }
    };
}

function main()
{
    const { app, keep } = appName();

    step('Checking the Fly.io CLI');
    const who = fly(['auth', 'whoami'], { quiet: true });
    if (who.missing) die('The Fly.io CLI isn’t installed (no `fly` on the PATH).', 'Install it: https://fly.io/docs/flyctl/install/', 'then open a new terminal and run this again.');
    if (!who.ok) die('Not logged in to Fly.io. Run `fly auth login` (or `fly auth signup` for a new account), then this again.');
    console.log(`  Logged in as ${who.output.trim().split('\n').pop()}`);

    if (!fly(['status', '--app', app], { quiet: true }).ok)
    {
        step(`Creating the app "${app}"`);
        if (!fly(['apps', 'create', app]).ok) die(`Couldn’t create "${app}". If the name is taken, choose another:`, 'npm run deploy:fly -- --app another-name');
    }
    // Only once the name is really this account's
    keep();

    const secrets = fly(['secrets', 'list', '--app', app], { quiet: true });
    if (!secrets.ok) die(`Couldn’t read the secrets of "${app}":`, secrets.output.trim());
    if (!secrets.output.includes('VAPID_PRIVATE_KEY'))
    {
        step('Making the keys that sign push notifications');
        // (web-push is the server's dependency, not this package's)
        const webpush = createRequire(path.join(ROOT, 'server', 'server.js'))('web-push');
        const keys = webpush.generateVAPIDKeys();
        // Through stdin, so the private key is never on a command line. --stage:
        // they take effect with the deploy below
        const saved = fly(['secrets', 'import', '--stage', '--app', app], {
            input: `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`
        });
        if (!saved.ok) die('Couldn’t save the push keys as Fly.io secrets.');
    }

    const version = readVersion(ROOT);
    if (version.build === null) die('Couldn’t read the version from git. Deploy from a clone of the repository.');
    const uncommitted = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
    step(`Deploying version ${version.build} · ${version.commit}`);
    if (uncommitted) console.log('  Note: there are uncommitted changes, and they are deployed too; the version shown won’t tell them apart.');

    const deployed = fly([
        'deploy', '--app', app,
        // One machine, not the pair Fly.io makes by default
        '--ha=false',
        '--build-arg', `MANHUNT_BUILD=${version.build}`,
        '--build-arg', `MANHUNT_COMMIT=${version.commit}`,
        '--build-arg', `MANHUNT_COMMIT_DATE=${version.date}`
    ]);
    if (!deployed.ok) die('The deploy didn’t finish. `fly logs` shows what the server said.');

    const rule = '─'.repeat(52);
    console.log(`\n${rule}\n  Manhunt is live at:\n  https://${app}.fly.dev\n  The iPhone and Android apps take this address once;\n  it stays the same from now on.\n${rule}\n`);
}

main();
