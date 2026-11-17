import type { OnlineProviderId, ProviderQualityChoiceEvent, ProviderQualityChoices } from '../../types/onlineMusic';
import { omni } from './omni';

// src/services/onlineMusic/playerQualityChoices.ts
// 播放器自己的音质档（externalPlayback.qualityChoices）：音质选择开着时读一次播放器的档和设置，之后跟着它的每次改动；
// 在这里选一档发给播放器，刚选的那一会儿不被它还没听到的旧设置盖回去，发不出去时退回原来那档。
// 播放器连不上、读不到时不列它的档（音质选择照用应用自己的档）；它再连上、又说话时重读，不漏掉。

/** 刚在这里选了一档：这么久之内播放器说的旧设置不算数。 */
const LOCAL_CHANGE_HOLD_MS = 2000;
/** 没读到档时，两次读之间至少隔这么久（播放器出错时不一直问它）。 */
const RETRY_MS = 5000;

type Entry = {
    snapshot: ProviderQualityChoices | null;
    subscribers: Set<() => void>;
    stopWatch: (() => void) | null;
    reading: boolean;
    /** 读着的时候播放器又说话了：读完还没读到档就再读一次。 */
    again: boolean;
    /** 播放器回答过它没有自己的档（旧版本）：它不再连上一次就不再问。 */
    unsupported: boolean;
    readAt: number;
    localAt: number;
    retryTimer: ReturnType<typeof setTimeout> | null;
};

const entries = new Map<OnlineProviderId, Entry>();

const entryOf = (providerId: OnlineProviderId): Entry => {
    let entry = entries.get(providerId);
    if (!entry) {
        entry = {
            snapshot: null, subscribers: new Set(), stopWatch: null, reading: false, again: false, unsupported: false,
            readAt: 0, localAt: 0, retryTimer: null,
        };
        entries.set(providerId, entry);
    }
    return entry;
};

const notify = (entry: Entry) => { entry.subscribers.forEach(listener => { listener(); }); };

const holding = (entry: Entry) => Date.now() - entry.localAt < LOCAL_CHANGE_HOLD_MS;

const clearSnapshot = (entry: Entry) => {
    if (!entry.snapshot) return;
    entry.snapshot = null;
    notify(entry);
};

const read = (providerId: OnlineProviderId, entry: Entry) => {
    if (entry.reading) {
        entry.again = true;
        return;
    }
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
    entry.reading = true;
    entry.again = false;
    entry.readAt = Date.now();
    omni.readExternalPlayerQualityChoices(providerId).then(snapshot => {
        // 刚选的那档还没被播放器说回来：留着它
        const kept = entry.snapshot && holding(entry) ? entry.snapshot.current : null;
        entry.snapshot = snapshot && kept ? { ...snapshot, current: kept } : snapshot;
        entry.unsupported = snapshot === null;
        notify(entry);
    }, (error: unknown) => {
        // 播放器没开、还在启动：不再列它的旧档
        console.warn('[PlayerQuality] the player quality levels could not be read', { providerId }, error);
        clearSnapshot(entry);
    }).finally(() => {
        entry.reading = false;
        if (entry.again && !entry.snapshot && !entry.unsupported && entry.subscribers.size) readSoon(providerId, entry);
    });
};

/** 还没读到档时播放器说话了：再读一次，离上次读不到 RETRY_MS 时等到那时（不丢下这一次）。 */
const readSoon = (providerId: OnlineProviderId, entry: Entry) => {
    if (entry.reading) {
        entry.again = true;
        return;
    }
    if (entry.retryTimer) return;
    const wait = Math.max(0, entry.readAt + RETRY_MS - Date.now());
    entry.retryTimer = setTimeout(() => {
        entry.retryTimer = null;
        if (entry.subscribers.size && !entry.snapshot) read(providerId, entry);
    }, wait);
};

const hear = (providerId: OnlineProviderId, entry: Entry, event: ProviderQualityChoiceEvent) => {
    if (event.type === 'reachable') {
        entry.unsupported = false;
        // 连上了（可能刚升级、刚启动）：马上重读；断开了：不再列它的档
        if (event.reachable) read(providerId, entry);
        else clearSnapshot(entry);
        return;
    }
    if (!entry.snapshot) {
        if (!entry.unsupported) readSoon(providerId, entry);
        return;
    }
    if (event.current === entry.snapshot.current || holding(entry)) return;
    entry.snapshot = { ...entry.snapshot, current: event.current };
    notify(entry);
};

/**
 * 有人要看 `providerId` 的播放器音质档：第一个来的读一次、开始跟着播放器的改动，最后一个走时停。
 * 回的是取消的函数（给 useSyncExternalStore）。
 */
export const subscribePlayerQualityChoices = (providerId: OnlineProviderId, listener: () => void): (() => void) => {
    const entry = entryOf(providerId);
    entry.subscribers.add(listener);
    if (entry.subscribers.size === 1) {
        entry.stopWatch = omni.watchExternalPlayerQualityChoice(providerId, event => { hear(providerId, entry, event); });
        entry.unsupported = false;
        read(providerId, entry);
    }
    return () => {
        entry.subscribers.delete(listener);
        if (entry.subscribers.size) return;
        entry.stopWatch?.();
        entry.stopWatch = null;
        if (entry.retryTimer) clearTimeout(entry.retryTimer);
        entry.retryTimer = null;
    };
};

/** 播放器的音质档和它现在的设置；没有这些档（不是这种播放器、没连上、旧版本）时 null。同一份不变时回同一个对象。 */
export const getPlayerQualityChoices = (providerId: OnlineProviderId): ProviderQualityChoices | null => entries.get(providerId)?.snapshot ?? null;

/** 在这里选了播放器的一档：马上亮起，发给播放器；发不出去时退回原来那档。 */
export const setPlayerQualityChoice = (providerId: OnlineProviderId, choice: string): void => {
    const entry = entries.get(providerId);
    if (!entry?.snapshot || entry.snapshot.current === choice) return;
    const previous = entry.snapshot.current;
    entry.snapshot = { ...entry.snapshot, current: choice };
    entry.localAt = Date.now();
    notify(entry);
    omni.setExternalPlayerQualityChoice(providerId, choice).then(() => {
        console.info('[PlayerQuality] the player quality was set', { providerId, choice });
    }, (error: unknown) => {
        console.warn('[PlayerQuality] the player quality could not be set', { providerId, choice }, error);
        entry.localAt = 0;
        if (entry.snapshot?.current !== choice) return;
        entry.snapshot = { ...entry.snapshot, current: previous };
        notify(entry);
    });
};
