import type { SongResult, UnifiedSong } from '../../../types';
import type { AudioQualityPreference, OnlineExternalPlaybackProvider, ProviderExternalPlaybackStatus } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { requestLxmusic, subscribeLxmusicEvents } from './lxmusicTransport';
import { isLxMusicInfo, LXMUSIC_PROVIDER_ID, lxMusicIdOf, lxMusicInfoOf, lxSongOriginOf, normalizeLxmusicSong, withLxCover, type LxMusicInfo, type LxSongOrigin } from './lxmusicNormalize';
import { readLxCoverUrl } from './lxmusicCover';
import { readLxListSongIds, readLxShareSongIds } from './lxmusicLibrary';

// src/services/onlineMusic/lxmusic/lxmusicPlayback.ts
// 洛雪放歌，Folia 跟着：外部播放路线的「播放器主导」一侧（leadsPlayback）。洛雪有自己的播放列表、播放模式、
// 音量，在洛雪里切歌或一首放完，Folia 按 follow 换上那首；Folia 的上一首 / 下一首交给洛雪（skip）。
// 在 Folia 里点一首歌，按它从哪来交给洛雪：我的列表里的从那个列表放，分享歌单里的进临时列表，搜索结果照洛雪
// 搜索页的做法进「试听列表」。

/** 洛雪 Folia 对接的状态（主进程 modules/foliaLink/state.ts 的 LinkPlayerState）。 */
export interface LxPlayerState {
    musicId: string | null;
    musicInfo: unknown;
    listId: string | null;
    isTempPlay: boolean;
    playLaterCount: number;
    isPlay: boolean;
    loading: boolean;
    positionMs: number;
    durationMs: number;
    rate: number;
    volume: number;
    mute: boolean;
    playMode: string;
    quality: { wanted?: string; current?: string; actual?: string };
    queueRev: number;
    listsRev: number;
    loveRev: number;
}

interface LxQueueAnswer {
    listId: string | null;
    isTempPlay: boolean;
    tempListId: string | null;
    list: unknown[];
    playLater: unknown[];
}

const LOOP_TO_LX: Record<'off' | 'all' | 'one', string> = { off: 'list', all: 'listLoop', one: 'singleLoop' };
/** 洛雪的音质设置换成 Folia 的档位：杜比全景声、母带这些更高的档算最高一档。 */
const QUALITY_FROM_LX: Record<string, AudioQualityPreference> = {
    '128k': 'standard', '192k': 'standard', '320k': 'high', flac: 'lossless',
    flac24bit: 'hires', hires: 'hires', atmos: 'hires', atmos_plus: 'hires', master: 'hires',
};
/** 跟随洛雪换歌时，等封面最多这么久；没等到就先换歌（封面读到后留着，下一次就有）。 */
const COVER_WAIT_MS = 1500;
/** 跟随之后多久内来的 play 才算接手（不叫洛雪换歌）；过了这么久、或洛雪已经不在这首上，就照常放。 */
const HANDOFF_MS = 10_000;
const QUALITY_TO_LX: Record<AudioQualityPreference, string> = { standard: '128k', high: '320k', ultra: '320k', lossless: 'flac', hires: 'hires' };
const QUALITY_LABELS: Record<string, string> = {
    '128k': '128K', '192k': '192K', '320k': '320K', flac: 'FLAC', flac24bit: 'Hi-Res', hires: 'Hi-Res',
    atmos: 'Atmos', atmos_plus: 'Atmos+', master: 'Master', ape: 'APE', wav: 'WAV',
};

/** 洛雪五种播放模式换成 Folia 的三种：随机算列表循环（下一首照样由洛雪定）。 */
export const lxLoopModeOf = (playMode: string): 'off' | 'all' | 'one' => {
    if (playMode === 'singleLoop') return 'one';
    if (playMode === 'list' || playMode === 'none') return 'off';
    return 'all';
};

/** 洛雪的音质设置在 Folia 的档位里是哪一档；认不出（本地、下载）时不说。 */
export const lxQualityOf = (quality: LxPlayerState['quality'] | undefined): AudioQualityPreference | undefined => (
    quality?.wanted ? QUALITY_FROM_LX[quality.wanted] : undefined
);

export const lxQualityLabelOf = (quality: LxPlayerState['quality'] | undefined): string | undefined => {
    const raw = quality?.actual || quality?.current;
    if (!raw) return undefined;
    return QUALITY_LABELS[raw] ?? raw;
};

const finiteOr = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** 洛雪的状态换成外部播放路线看的那一份；读不出就抛 invalid-response。 */
export const lxExternalStatusOf = (raw: unknown): ProviderExternalPlaybackStatus => {
    const state = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<LxPlayerState>;
    if (typeof state.isPlay !== 'boolean') {
        throw new OnlineProviderError('invalid-response', 'LX Music playback status is invalid', LXMUSIC_PROVIDER_ID);
    }
    const mediaId = typeof state.musicId === 'string' ? state.musicId : '';
    const loading = state.loading === true;
    return {
        mediaId,
        isPlaying: Boolean(mediaId) && state.isPlay && !loading,
        positionMs: mediaId ? Math.max(0, finiteOr(state.positionMs, 0)) : 0,
        durationMs: mediaId ? Math.max(0, finiteOr(state.durationMs, 0)) : 0,
        // 洛雪放完一首自己往下放：Folia 看到的是换了歌（follow），不是放完
        ended: false,
        ...(loading && mediaId ? { starting: true } : {}),
        rate: finiteOr(state.rate, 1) > 0 ? finiteOr(state.rate, 1) : 1,
        // 洛雪没说的不替它说：主导模式会把音量、静音、播放模式写进 Folia 的设置
        ...(typeof state.volume === 'number' && Number.isFinite(state.volume) ? { volume: Math.min(1, Math.max(0, state.volume)) } : {}),
        ...(typeof state.mute === 'boolean' ? { muted: state.mute } : {}),
        ...(typeof state.playMode === 'string' && state.playMode ? { loopMode: lxLoopModeOf(state.playMode) } : {}),
        ...(typeof state.queueRev === 'number' ? { queueRevision: String(state.queueRev) } : {}),
        ...(lxQualityOf(state.quality) ? { quality: lxQualityOf(state.quality) } : {}),
        ...(lxQualityLabelOf(state.quality) ? { qualityLabel: lxQualityLabelOf(state.quality) } : {}),
    };
};

/**
 * 洛雪的播放队列在 Folia 里的样子：正在播放的列表，「稍后播放」的歌排在当前这首后面；当前这首是稍后播放的
 * （不在列表里）时排在最前。
 */
export const composeLxQueue = (answer: LxQueueAnswer, currentId: string | null, current: LxMusicInfo | null): UnifiedSong[] => {
    const origin = { listId: answer.listId };
    const list = answer.list.filter(isLxMusicInfo).map(info => normalizeLxmusicSong(info, origin));
    // 稍后播放的歌记着它排在稍后播放里：在 Folia 的队列里点它，洛雪从稍后播放里放，不换正在播放的列表
    const later = answer.playLater.filter(isLxMusicInfo).map(info => normalizeLxmusicSong(info, { later: true }));
    const index = currentId ? list.findIndex(song => song.id === currentId) : -1;
    if (index >= 0) return [...list.slice(0, index + 1), ...later, ...list.slice(index + 1)];
    const head = current ? [normalizeLxmusicSong(current)] : [];
    return [...head, ...later.filter(song => song.id !== currentId), ...list];
};

/** 洛雪一次接的队列最多这么多首（它接口一批的上限）：更长时取播放的那首起的一段。 */
const LX_QUEUE_LIMIT = 1000;

type LxStartTarget = { target: string } & Record<string, unknown>;

/**
 * 在 Folia 里起播一首洛雪的歌，交给洛雪的方式。歌自带的来源说它从哪来：稍后播放里的从稍后播放放；搜索结果照
 * 洛雪搜索页的做法进试听列表；我的列表、分享歌单里的，Folia 交来的队列就是那张列表（按洛雪的顺序；稍后播放的
 * 不算，列表还没读完时是开头那一段也算）时从那张列表放；队列被打乱、筛过、加过歌时，把这份队列交给洛雪的
 * 临时列表，照它的顺序往下放（洛雪那边的队列于是和 Folia 显示的一样）。`readOrder` 读那张列表的顺序。
 */
export async function lxStartTargetOf(
    song: SongResult,
    queue: SongResult[] | undefined,
    readOrder: (origin: LxSongOrigin) => Promise<string[]>,
): Promise<LxStartTarget> {
    const id = lxMusicIdOf(song);
    const info = lxMusicInfoOf(song);
    const origin = lxSongOriginOf(song);
    if (origin.later) return { target: 'later', musicInfos: [info], now: true };
    const fromList: LxStartTarget | null = origin.share
        ? { target: 'songlist', text: origin.share.text, source: origin.share.source, musicId: id }
        : origin.listId
            ? { target: 'list', listId: origin.listId, musicId: id }
            : null;
    if (!fromList) return { target: 'search', musicInfo: info };
    // 队列里洛雪的歌（不算稍后播放的）
    const own = (queue ?? []).filter(item => !lxSongOriginOf(item).later).flatMap(item => {
        try { return [lxMusicInfoOf(item)]; } catch { return []; }
    });
    const index = own.findIndex(item => item.id === id);
    if (index < 0) return fromList;
    let order: string[];
    try {
        order = await readOrder(origin);
    } catch (error) {
        console.warn('[LxMusic] could not read the list order to start from: playing from the list', error);
        return fromList;
    }
    if (own.length <= order.length && own.every((item, at) => item.id === order[at])) return fromList;
    const start = Math.max(0, Math.min(index, own.length - LX_QUEUE_LIMIT));
    return { target: 'queue', musicInfos: own.slice(start, start + LX_QUEUE_LIMIT), musicId: id };
}

/** 等一个读取最多这么久：读完了回它的结果，没读完或读失败回 null（读到的封面照样留着）。 */
const within = <T>(work: Promise<T>, ms: number): Promise<T | null> => new Promise(resolve => {
    const timer = setTimeout(() => { resolve(null); }, ms);
    work.then(value => {
        clearTimeout(timer);
        resolve(value);
    }, () => {
        clearTimeout(timer);
        resolve(null);
    });
});

export function createLxmusicExternalPlayback(): OnlineExternalPlaybackProvider {
    /** 最近一次读到的洛雪状态。 */
    let lastState: LxPlayerState | null = null;
    /** 洛雪自己换到的这首和跟随它的时刻：随后 play 它时不重新开始，接着放（follow 之后 Folia 的 playSong 会来 play）。 */
    let handoff: { id: string; at: number } | null = null;
    /** 刚跟过、洛雪还在这首上：play 它就是接手。 */
    const isHandedOff = (id: string) => handoff !== null && handoff.id === id && Date.now() - handoff.at < HANDOFF_MS && lastState?.musicId === id;
    let queueCache: { revision: number; currentId: string | null; songs: UnifiedSong[] } | null = null;

    const readState = async () => {
        const state = await requestLxmusic<LxPlayerState>('status');
        lastState = state;
        return state;
    };

    const control = async (action: string, value?: unknown) => {
        await requestLxmusic('control', value === undefined ? { action } : { action, value });
    };

    const readQueue = async (state: LxPlayerState): Promise<UnifiedSong[]> => {
        if (queueCache && queueCache.revision === state.queueRev && queueCache.currentId === state.musicId) return queueCache.songs;
        const answer = await requestLxmusic<LxQueueAnswer>('queue');
        const current = isLxMusicInfo(state.musicInfo) ? state.musicInfo : null;
        const songs = composeLxQueue(answer, state.musicId, current);
        queueCache = { revision: state.queueRev, currentId: state.musicId, songs };
        return songs;
    };

    /** 当前在放的这首（带上它所在的列表），没封面时问洛雪要一张。 */
    const currentSongOf = async (state: LxPlayerState): Promise<UnifiedSong | null> => {
        if (!state.musicId || !isLxMusicInfo(state.musicInfo)) return null;
        const song = normalizeLxmusicSong(state.musicInfo, { listId: state.isTempPlay ? null : state.listId });
        if (song.album.coverUrl) return song;
        return withLxCover(song, await within(readLxCoverUrl(state.musicInfo), COVER_WAIT_MS));
    };

    return {
        leadsPlayback: true,
        canPlay: song => {
            try { lxMusicInfoOf(song); return true; } catch { return false; }
        },
        isPrepared: song => {
            try { return isHandedOff(lxMusicIdOf(song)); } catch { return false; }
        },
        async play(song, startSec, context) {
            const id = lxMusicIdOf(song);
            // 洛雪自己换到了这首（follow）：它已经在放，什么都不用做
            const handedOff = isHandedOff(id);
            handoff = null;
            if (handedOff) return;
            const seconds = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
            // 洛雪已经停在这首上（Folia 重开后点播放、点了正在放的那首）：接着放，不从头开始。现读一次，旧的状态可能已经换了歌
            const state = await readState().catch(() => null);
            if (state?.musicId === id) {
                if (seconds > 0 && Math.abs(state.positionMs / 1000 - seconds) > 2) await control('seek', seconds);
                await control('play');
                console.info('[LxMusic] resumed the song LX Music already has');
                return;
            }
            const target = await lxStartTargetOf(song, context?.queue, origin => (
                origin.share ? readLxShareSongIds(origin.share.source, origin.share.text) : readLxListSongIds(origin.listId ?? '')
            ));
            await requestLxmusic('play', target);
            if (seconds > 1) await control('seek', seconds);
            console.info('[LxMusic] play started', { target: target.target });
        },
        // 窗口重建后新窗口接着跟：洛雪那边什么都不用动
        adopt() {
            handoff = null;
        },
        async pause() { await control('pause'); },
        async resume() { await control('play'); },
        async seek(seconds) {
            if (!Number.isFinite(seconds) || seconds < 0) throw new OnlineProviderError('invalid-response', 'LX Music seek position is invalid', LXMUSIC_PROVIDER_ID);
            await control('seek', Math.round(seconds * 1000) / 1000);
        },
        async setVolume(volume, muted) {
            if (!Number.isFinite(volume)) throw new OnlineProviderError('invalid-response', 'LX Music volume is invalid', LXMUSIC_PROVIDER_ID);
            const level = Math.round(Math.min(1, Math.max(0, volume)) * 1000) / 1000;
            if (muted === undefined) {
                await control('volume', level);
                return;
            }
            await control('volume', level);
            if (lastState?.mute !== muted) await control('mute', muted);
        },
        async setLoopMode(mode) { await control('playMode', LOOP_TO_LX[mode]); },
        async setQuality(quality) { await control('quality', QUALITY_TO_LX[quality]); },
        async skip(direction) { await control(direction); },
        // 洛雪的「稍后播放」：下一首播放排在最前，加入队列排在最后
        async queueInPlayer(songs, position) {
            await requestLxmusic('play', { target: 'later', musicInfos: songs.map(lxMusicInfoOf), top: position === 'next' });
        },
        async getStatus() {
            return lxExternalStatusOf(await readState());
        },
        isStatusForSong(song, status) {
            try { return status.mediaId === lxMusicIdOf(song); } catch { return false; }
        },
        async follow(status) {
            let state = lastState;
            if (!state || state.musicId !== status.mediaId) state = await readState();
            const song = await currentSongOf(state);
            if (!song) return null;
            const queue = await readQueue(state).catch((error: unknown) => {
                console.warn('[LxMusic] could not read the queue to follow', error);
                return [song];
            });
            handoff = { id: song.id as string, at: Date.now() };
            return { song, queue: queue.length ? queue : [song] };
        },
        async getQueue() {
            return await readQueue(lastState ?? await readState());
        },
        watchPlayer(tell) {
            // 洛雪推来的状态：开始放一首（换了歌，或者从暂停到播放）时告诉一声
            let toldKey = '';
            const hear = (raw: unknown) => {
                let status: ProviderExternalPlaybackStatus;
                try { status = lxExternalStatusOf(raw); } catch { return; }
                lastState = raw as LxPlayerState;
                const key = status.isPlaying ? status.mediaId : '';
                if (key === toldKey) return;
                toldKey = key;
                if (key) tell(status);
            };
            const stop = subscribeLxmusicEvents(event => {
                if (event.type === 'state') hear(event.data);
            });
            // Folia 打开时洛雪可能已经在放（它的第一条状态在窗口出来之前就推过了）：连接过的话问一次
            void requestLxmusic<{ linked?: boolean } | null>('linkStatus')
                .then(link => (link?.linked ? readState() : null))
                .then(state => { if (state) hear(state); }, () => {});
            return stop;
        },
    };
}
