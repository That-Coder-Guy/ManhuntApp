import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isAllowedOrigin } = require('../server/origins.js');

function withEnv(vars, fn)
{
    const saved = {};
    for (const key of Object.keys(vars)) {
        saved[key] = process.env[key];
        if (vars[key] === undefined) delete process.env[key];
        else process.env[key] = vars[key];
    }
    try { fn(); }
    finally {
        for (const key of Object.keys(vars)) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    }
}

test('allows a fresh ngrok tunnel origin', () => {
    assert.equal(isAllowedOrigin('https://abc123.ngrok-free.app'), true);
    assert.equal(isAllowedOrigin('https://tame-otter-42.ngrok.app'), true);
    assert.equal(isAllowedOrigin('https://foo.ngrok-free.dev'), true);
    assert.equal(isAllowedOrigin('https://foo.ngrok.io'), true);
    assert.equal(isAllowedOrigin('https://foo.trycloudflare.com'), true);
});

test('allows localhost / 127.0.0.1 on any port', () => {
    assert.equal(isAllowedOrigin('http://localhost:5173'), true);
    assert.equal(isAllowedOrigin('http://localhost:3001'), true);
    assert.equal(isAllowedOrigin('http://127.0.0.1:4173'), true);
});

test('allows private-network (LAN) origins on any port', () => {
    assert.equal(isAllowedOrigin('http://192.168.1.50:5173'), true);
    assert.equal(isAllowedOrigin('http://10.0.0.7:5173'), true);
    assert.equal(isAllowedOrigin('http://172.16.4.2:5173'), true);
    assert.equal(isAllowedOrigin('http://my-desktop.local:5173'), true);
    // 172.32.x.x is outside the RFC 1918 172.16/12 block
    assert.equal(isAllowedOrigin('http://172.32.0.1:5173'), false);
});

test('allows no-origin (same-origin / non-browser) requests', () => {
    assert.equal(isAllowedOrigin(undefined), true);
    assert.equal(isAllowedOrigin(''), true);
});

test('rejects an arbitrary third-party origin by default', () => {
    withEnv({ TRUST_ALL_ORIGINS: undefined, ALLOWED_ORIGINS: undefined }, () => {
        assert.equal(isAllowedOrigin('https://evil.example.com'), false);
        assert.equal(isAllowedOrigin('https://ngrok-free.app.evil.com'), false);
    });
});

test('rejects a malformed origin', () => {
    assert.equal(isAllowedOrigin('not a url'), false);
});

test('honors the ALLOWED_ORIGINS env allowlist', () => {
    withEnv({ ALLOWED_ORIGINS: 'https://my-host.example, https://other.example' }, () => {
        assert.equal(isAllowedOrigin('https://my-host.example'), true);
        assert.equal(isAllowedOrigin('https://other.example'), true);
        assert.equal(isAllowedOrigin('https://not-listed.example'), false);
    });
});

test('TRUST_ALL_ORIGINS=1 allows anything', () => {
    withEnv({ TRUST_ALL_ORIGINS: '1' }, () => {
        assert.equal(isAllowedOrigin('https://evil.example.com'), true);
    });
});

test('subdomain-suffix check is anchored (no substring bypass)', () => {
    // ".ngrok.app" must be a real suffix, not appear mid-host
    assert.equal(isAllowedOrigin('https://ngrok.app.attacker.com'), false);
});
