const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

// electron/lxmusic/lxmusicApiBridge.cjs
// 洛雪音乐（lx-music-desktop-enhanced）的「Folia 对接」本机接口：洛雪开着对接时把端口和令牌写进系统应用数据目录下的
// lx-music-folia-link/connection.json（只有本用户能读），这里读它，带令牌请求 127.0.0.1 上的接口，令牌不交给渲染进程。
// 对外一个 request(operation, params)，回 { ok: true, data } 或 { ok: false, error: { code, message, cause } }：
// code 是 Folia 共用的错误码，cause 是洛雪自己的码（lxmusicFailure.ts 按它分情况）。
// 连接过（link）之后订阅洛雪的事件流（/events），把状态、列表的变化和连上断开经 onEvent 交给主窗口。

const LINKED_KEY = 'LXMUSIC_LINKED';
const LINK_DIR_NAME = 'lx-music-folia-link';
const LINK_FILE_NAME = 'connection.json';

/** 主进程直接处理的操作 */
const LOCAL_OPERATIONS = new Set(['link', 'unlink', 'linkStatus', 'status']);
/** 转给洛雪 /rpc 的操作（洛雪主进程 modules/foliaLink/ops.ts 的白名单） */
const RPC_OPERATIONS = new Set([
    'info', 'search', 'songlistDetail', 'songlistAll', 'songlistCollect', 'lyric', 'pic', 'play', 'control', 'queue',
    'lists', 'listMusics', 'listAdd', 'listRemove', 'likedIds',
]);

const DEFAULT_TIMEOUT_MS = 20_000;
const TIMEOUTS = { search: 35_000, songlistDetail: 35_000, songlistAll: 185_000, songlistCollect: 185_000, play: 65_000, lyric: 35_000, pic: 25_000, status: 4_000 };
const EVENTS_RETRY_MS = 3_000;

/** 洛雪的码换成 Folia 共用的码 */
const CODE_MAP = {
    'invalid-params': 'invalid-response',
    'unknown-op': 'unsupported',
    'unknown-source': 'unsupported',
    'not-playable': 'not-playable',
    // 列表里没有这首、歌单是空的、列表已经删了：不是没有音源
    'not-found': 'unavailable',
    unavailable: 'unavailable',
    timeout: 'network',
    failed: 'invalid-response',
};

/** 系统默认的应用数据目录（与洛雪 foliaStage/connection.ts 的 resolveSystemAppDataDir 一致） */
function resolveSystemAppDataDir({ platform = process.platform, env = process.env, homeDir = os.homedir() } = {}) {
    if (platform === 'win32') return env.APPDATA && env.APPDATA.trim() ? env.APPDATA : path.join(homeDir, 'AppData', 'Roaming');
    if (platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support');
    return env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(homeDir, '.config');
}

/** 洛雪的连接文件可能在的位置，按顺序找 */
function resolveLinkFilePaths({ platform = process.platform, env = process.env, homeDir = os.homedir() } = {}) {
    const paths = [];
    const runtimeDir = env.XDG_RUNTIME_DIR;
    if (platform === 'linux' && runtimeDir && path.isAbsolute(runtimeDir)) paths.push(path.join(runtimeDir, LINK_DIR_NAME, LINK_FILE_NAME));
    paths.push(path.join(resolveSystemAppDataDir({ platform, env, homeDir }), LINK_DIR_NAME, LINK_FILE_NAME));
    return paths;
}

/** 只接受本机回环地址：令牌和请求不能发去别处 */
function parseLinkFile(text) {
    let data;
    try { data = JSON.parse(text); } catch { return null; }
    if (!data || data.version !== 1) return null;
    const port = Number(data.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    if (typeof data.token !== 'string' || !data.token) return null;
    if (data.baseUrl !== undefined && data.baseUrl !== `http://127.0.0.1:${port}`) return null;
    const pid = Number(data.pid);
    return { pid: Number.isInteger(pid) ? pid : 0, port, token: data.token, appVersion: typeof data.appVersion === 'string' ? data.appVersion : null };
}

/** 写连接文件的洛雪进程还在不在（崩溃时文件会残留） */
function isProcessAlive(pid) {
    if (!pid) return true;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error && error.code === 'EPERM';
    }
}

class LinkError extends Error {
    constructor(code, message, cause) {
        super(message);
        this.code = code;
        this.lxCause = cause;
    }
}

function createLxmusicApiBridge({
    store,
    linkFilePaths = resolveLinkFilePaths(),
    readFile = filePath => fs.promises.readFile(filePath, 'utf-8'),
    isAlive = isProcessAlive,
    httpModule = http,
    onEvent = () => {},
    warn = console.warn,
    info = console.info,
    eventsRetryMs = EVENTS_RETRY_MS,
} = {}) {
    let events = null;
    let eventsTimer = null;
    /** 正在读连接文件准备连事件流：同时只开一条 */
    let eventsOpening = false;
    let lastConnected = null;

    const isLinked = () => store.get(LINKED_KEY) === true;

    const readConnection = async () => {
        for (const filePath of linkFilePaths) {
            let text;
            try { text = await readFile(filePath); } catch { continue; }
            const connection = parseLinkFile(text);
            if (connection && isAlive(connection.pid)) return connection;
        }
        return null;
    };

    const setConnected = (connected) => {
        if (lastConnected === connected) return;
        lastConnected = connected;
        info(`[LxMusic] ${connected ? 'connected to' : 'lost'} LX Music`);
        onEvent({ type: 'connection', data: { connected } });
    };

    // 一次 HTTP 请求：只连 127.0.0.1，不走代理
    const send = (connection, method, pathname, body, timeoutMs) => new Promise((resolve, reject) => {
        const data = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf-8');
        const req = httpModule.request({
            host: '127.0.0.1',
            port: connection.port,
            path: pathname,
            method,
            timeout: timeoutMs,
            headers: {
                Authorization: `Bearer ${connection.token}`,
                ...(data ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length } : {}),
            },
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')); } catch { /* 非 JSON 按读不出处理 */ }
                resolve({ status: res.statusCode ?? 0, body: parsed });
            });
            res.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new LinkError('network', 'LX Music did not answer in time', 'timeout')));
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });

    // 带重试一次的请求：令牌对不上（洛雪重开换了令牌）时重读连接文件再试
    const call = async (method, pathname, body, timeoutMs) => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const connection = await readConnection();
            if (!connection) {
                setConnected(false);
                throw new LinkError('unavailable', 'LX Music is not running, or its Folia link is off', 'not-running');
            }
            let response;
            try {
                response = await send(connection, method, pathname, body, timeoutMs);
            } catch (error) {
                if (error instanceof LinkError) throw error;
                setConnected(false);
                throw new LinkError('unavailable', 'LX Music could not be reached', 'not-running');
            }
            setConnected(true);
            if (response.status === 401 && attempt === 0) continue;
            if (response.status === 401) throw new LinkError('unavailable', 'LX Music refused the link token', 'unauthorized');
            const answer = response.body;
            if (answer && answer.ok === true) return answer.data;
            const lxCode = answer && answer.error && typeof answer.error.code === 'string' ? answer.error.code : 'failed';
            const message = answer && answer.error && typeof answer.error.message === 'string' ? answer.error.message : `LX Music answered ${response.status}`;
            throw new LinkError(CODE_MAP[lxCode] || 'invalid-response', message, lxCode);
        }
        throw new LinkError('unavailable', 'LX Music refused the link token', 'unauthorized');
    };

    // ---------- 事件流 ----------

    const stopEvents = () => {
        if (eventsTimer) clearTimeout(eventsTimer);
        eventsTimer = null;
        if (events) {
            const req = events;
            events = null;
            req.destroy();
        }
    };

    const scheduleEvents = (delayMs) => {
        if (eventsTimer || !isLinked()) return;
        eventsTimer = setTimeout(() => {
            eventsTimer = null;
            void openEvents();
        }, delayMs);
        eventsTimer.unref?.();
    };

    const openEvents = async () => {
        if (events || eventsOpening || !isLinked()) return;
        eventsOpening = true;
        let connection;
        try {
            connection = await readConnection();
        } finally {
            eventsOpening = false;
        }
        // 读连接文件的时候断开了连接（unlink）或已经开了一条：不再开
        if (events || !isLinked()) return;
        if (!connection) {
            setConnected(false);
            scheduleEvents(eventsRetryMs);
            return;
        }
        const req = httpModule.request({
            host: '127.0.0.1',
            port: connection.port,
            path: '/events',
            method: 'GET',
            headers: { Authorization: `Bearer ${connection.token}`, Accept: 'text/event-stream' },
        }, res => {
            if (res.statusCode !== 200) {
                res.resume();
                req.destroy();
                return;
            }
            setConnected(true);
            res.setEncoding('utf-8');
            let buffer = '';
            res.on('data', chunk => {
                buffer += chunk;
                let index;
                while ((index = buffer.indexOf('\n\n')) >= 0) {
                    const block = buffer.slice(0, index);
                    buffer = buffer.slice(index + 2);
                    let type = 'message';
                    const dataLines = [];
                    for (const line of block.split('\n')) {
                        if (line.startsWith('event:')) type = line.slice(6).trim();
                        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
                    }
                    if (!dataLines.length || (type !== 'state' && type !== 'lists')) continue;
                    try {
                        onEvent({ type, data: JSON.parse(dataLines.join('\n')) });
                    } catch (error) {
                        warn('[LxMusic] an unreadable event from LX Music', error);
                    }
                }
            });
        });
        events = req;
        const closed = () => {
            if (events !== req) return;
            events = null;
            scheduleEvents(eventsRetryMs);
        };
        req.on('error', closed);
        req.on('close', closed);
        req.end();
    };

    if (isLinked()) scheduleEvents(0);

    return {
        async request(operation, params = {}) {
            try {
                if (!LOCAL_OPERATIONS.has(operation) && !RPC_OPERATIONS.has(operation)) {
                    return { ok: false, error: { code: 'unsupported', message: 'Unsupported LX Music operation' } };
                }
                if (operation === 'linkStatus') {
                    const connection = await readConnection();
                    return { ok: true, data: { linked: isLinked(), connected: Boolean(connection), appVersion: connection ? connection.appVersion : null } };
                }
                if (operation === 'unlink') {
                    store.delete(LINKED_KEY);
                    stopEvents();
                    info('[LxMusic] unlinked');
                    return { ok: true, data: null };
                }
                if (operation === 'link') {
                    // 洛雪真的答了才算连上
                    await call('GET', '/status', undefined, TIMEOUTS.status);
                    const connection = await readConnection();
                    store.set(LINKED_KEY, true);
                    info('[LxMusic] linked', { appVersion: connection ? connection.appVersion : null });
                    scheduleEvents(0);
                    return { ok: true, data: { appVersion: connection ? connection.appVersion : null } };
                }
                if (operation === 'status') {
                    return { ok: true, data: await call('GET', '/status', undefined, TIMEOUTS.status) };
                }
                const data = await call('POST', '/rpc', { op: operation, params: params ?? {} }, TIMEOUTS[operation] ?? DEFAULT_TIMEOUT_MS);
                return { ok: true, data };
            } catch (error) {
                if (error instanceof LinkError) return { ok: false, error: { code: error.code, message: error.message, cause: error.lxCause } };
                warn('[LxMusic] the request failed', error);
                return { ok: false, error: { code: 'invalid-response', message: 'LX Music request failed', cause: 'failed' } };
            }
        },
        close() {
            stopEvents();
        },
    };
}

module.exports = { createLxmusicApiBridge, resolveLinkFilePaths, parseLinkFile, LINKED_KEY };
