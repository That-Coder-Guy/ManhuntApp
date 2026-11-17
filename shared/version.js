// The app's version, read from git when the app is built or the server starts:
//   build   — the number of commits, so every update gets a higher number
//   commit  — the short commit ID, to tell exactly which update it is
//   date    — when that commit was made (ISO 8601)
// Both the frontend build (vite.config.js) and the server use this, so the
// landing page can tell whether the two are the same update.
import { execFileSync } from 'node:child_process';

const UNKNOWN = Object.freeze({ build: null, commit: 'unknown', date: null });

function git(cwd, args)
{
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** The version of the repository at `cwd`, or "unknown" outside a git checkout */
export function readVersion(cwd)
{
    try {
        return {
            build: Number(git(cwd, ['rev-list', '--count', 'HEAD'])),
            commit: git(cwd, ['rev-parse', '--short=7', 'HEAD']),
            date: git(cwd, ['log', '-1', '--format=%cI'])
        };
    } catch {
        return UNKNOWN;
    }
}
