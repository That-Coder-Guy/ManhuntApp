// The app's version, read from git when the app is built or the server starts:
//   build   — the number of commits, so every update gets a higher number
//   commit  — the short commit ID, to tell exactly which update it is
//   date    — when that commit was made (ISO 8601)
// Both the frontend build (vite.config.js) and the server use this, so the
// landing page can tell whether the two are the same update.
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const UNKNOWN = Object.freeze({ build: null, commit: 'unknown', date: null });

function git(cwd, args)
{
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// A container image has no git checkout to read: whoever builds it reads the
// version first and passes it in (the Dockerfile, from scripts/deploy-fly.mjs)
function fromEnvironment(env)
{
    const build = Number(env.MANHUNT_BUILD);
    const commit = env.MANHUNT_COMMIT;
    if (!Number.isInteger(build) || build <= 0 || !/^[0-9a-f]{7,40}$/.test(commit || '')) return null;
    return { build, commit, date: env.MANHUNT_COMMIT_DATE || null };
}

/**
 * The version of the repository at `cwd`. Outside a git checkout it's what
 * MANHUNT_BUILD, MANHUNT_COMMIT and MANHUNT_COMMIT_DATE say, or "unknown".
 */
export function readVersion(cwd, env = process.env)
{
    try {
        return {
            build: Number(git(cwd, ['rev-list', '--count', 'HEAD'])),
            commit: git(cwd, ['rev-parse', '--short=7', 'HEAD']),
            date: git(cwd, ['log', '-1', '--format=%cI'])
        };
    } catch {
        return fromEnvironment(env) ?? UNKNOWN;
    }
}
