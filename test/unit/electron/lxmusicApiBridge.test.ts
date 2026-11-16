import { createRequire } from 'node:module';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

// test/unit/electron/lxmusicApiBridge.test.ts
// 洛雪「Folia 对接」的桥：连接文件的解析、带令牌的请求、令牌换了重读、洛雪没开时的回答、连接过的记号、事件流。

const require = createRequire(import.meta.url);
const { createLxmusicApiBridge, parseLinkFile, resolveLinkFilePaths, LINKED_KEY } = require('../../../electron/lxmusic/lxmusicApiBridge.cjs');

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;

const servers: http.Server[] = [];
const bridges: Array<{ close: () => void }> = [];

const startLx = async (handler: Handler) => {
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => handler(req, res, body));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return (server.address() as AddressInfo).port;
};

const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
};

const memoryStore = () => {
    const data = new Map<string, unknown>();
    return { get: (key: string) => data.get(key), set: (key: string, value: unknown) => { data.set(key, value); }, delete: (key: string) => { data.delete(key); }, data };
};

const bridgeFor = (files: Record<string, string>, store = memoryStore(), onEvent: (event: unknown) => void = () => {}) => {
    const bridge = createLxmusicApiBridge({
        store,
        linkFilePaths: Object.keys(files),
        readFile: async (filePath: string) => {
            if (!(filePath in files)) throw new Error('missing');
            return files[filePath];
        },
        isAlive: () => true,
        onEvent,
        warn: () => {},
        info: () => {},
    });
    bridges.push(bridge);
    return bridge;
};

const linkFile = (port: number, token: string) => JSON.stringify({ version: 1, pid: 1, port, baseUrl: `http://127.0.0.1:${port}`, token, appVersion: '3.4.0' });

afterEach(async () => {
    bridges.splice(0).forEach(bridge => bridge.close());
    await Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
});

describe('the LX Music link file', () => {
    it('is read only for a loopback port and a token', () => {
        expect(parseLinkFile(linkFile(5000, 'abc'))).toEqual({ pid: 1, port: 5000, token: 'abc', appVersion: '3.4.0' });
        expect(parseLinkFile(JSON.stringify({ version: 1, port: 5000, token: 'abc', baseUrl: 'http://evil.example:5000' }))).toBeNull();
        expect(parseLinkFile(JSON.stringify({ version: 2, port: 5000, token: 'abc' }))).toBeNull();
        expect(parseLinkFile(JSON.stringify({ version: 1, port: 0, token: 'abc' }))).toBeNull();
        expect(parseLinkFile('{nope')).toBeNull();
    });

    it('lies under the system app data folder, the runtime folder first on Linux', () => {
        expect(resolveLinkFilePaths({ platform: 'darwin', env: {}, homeDir: '/Users/a' })).toEqual(['/Users/a/Library/Application Support/lx-music-folia-link/connection.json'.replace(/\//g, require('node:path').sep)]);
        const linux = resolveLinkFilePaths({ platform: 'linux', env: { XDG_RUNTIME_DIR: '/run/user/1' }, homeDir: '/home/a' });
        expect(linux).toHaveLength(2);
        expect(linux[0]).toContain('run');
    });
});

describe('the LX Music bridge', () => {
    it('says LX Music is not running when there is no link file', async () => {
        const bridge = bridgeFor({});
        expect(await bridge.request('search', { text: 'a' })).toEqual({ ok: false, error: { code: 'unavailable', message: expect.any(String), cause: 'not-running' } });
        expect(await bridge.request('linkStatus')).toEqual({ ok: true, data: { linked: false, connected: false, appVersion: null } });
    });

    it('refuses an operation outside its list', async () => {
        expect(await bridgeFor({}).request('eval', {})).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    });

    it('sends the token, posts rpc calls and passes the answer on', async () => {
        const seen: Array<{ url?: string; auth?: string; body: string }> = [];
        const port = await startLx((req, res, body) => {
            seen.push({ url: req.url, auth: req.headers.authorization, body });
            json(res, 200, { ok: true, data: { list: [1] } });
        });
        const bridge = bridgeFor({ f: linkFile(port, 'secret') });
        expect(await bridge.request('search', { text: 'a', source: 'all', page: 1 })).toEqual({ ok: true, data: { list: [1] } });
        expect(seen[0]).toEqual({ url: '/rpc', auth: 'Bearer secret', body: JSON.stringify({ op: 'search', params: { text: 'a', source: 'all', page: 1 } }) });
    });

    it('reads the link file again when LX Music refuses the token, once', async () => {
        const files: Record<string, string> = {};
        let calls = 0;
        const port = await startLx((req, res) => {
            calls += 1;
            if (req.headers.authorization !== 'Bearer new') return json(res, 401, { ok: false, error: { code: 'unauthorized' } });
            json(res, 200, { ok: true, data: 'ok' });
        });
        files.f = linkFile(port, 'old');
        const bridge = createLxmusicApiBridge({
            store: memoryStore(), linkFilePaths: ['f'], isAlive: () => true, warn: () => {}, info: () => {},
            readFile: async () => { const text = files.f; files.f = linkFile(port, 'new'); return text; },
        });
        bridges.push(bridge);
        expect(await bridge.request('status')).toEqual({ ok: true, data: 'ok' });
        expect(calls).toBe(2);
    });

    it('turns LX Music errors into the shared codes, keeping its own as the cause', async () => {
        const port = await startLx((_req, res) => json(res, 400, { ok: false, error: { code: 'not-playable', message: 'no source' } }));
        const bridge = bridgeFor({ f: linkFile(port, 't') });
        expect(await bridge.request('play', {})).toEqual({ ok: false, error: { code: 'not-playable', message: 'no source', cause: 'not-playable' } });
    });

    it('is linked only after LX Music answered, until unlinked', async () => {
        const port = await startLx((req, res) => {
            if (req.url === '/events') {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.write('event: state\ndata: {"musicId":"kw_1"}\n\n');
                return;
            }
            json(res, 200, { ok: true, data: {} });
        });
        const store = memoryStore();
        const events: unknown[] = [];
        const bridge = bridgeFor({ f: linkFile(port, 't') }, store, event => events.push(event));
        expect(await bridge.request('link')).toEqual({ ok: true, data: { appVersion: '3.4.0' } });
        expect(store.data.get(LINKED_KEY)).toBe(true);
        await expect.poll(() => events.some(event => (event as { type: string }).type === 'state')).toBe(true);
        expect(events).toContainEqual({ type: 'state', data: { musicId: 'kw_1' } });
        expect(events).toContainEqual({ type: 'connection', data: { connected: true } });
        expect(await bridge.request('unlink')).toEqual({ ok: true, data: null });
        expect(store.data.has(LINKED_KEY)).toBe(false);
    });

    it('is not linked when LX Music does not answer', async () => {
        const store = memoryStore();
        expect(await bridgeFor({}, store).request('link')).toMatchObject({ ok: false, error: { code: 'unavailable', cause: 'not-running' } });
        expect(store.data.has(LINKED_KEY)).toBe(false);
    });
});
