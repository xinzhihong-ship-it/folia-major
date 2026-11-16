import type { UnifiedSong } from '../../../types';
import type { AudioQualityPreference, OnlineExternalPlaybackProvider, ProviderExternalPlaybackStatus } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { requestLxmusic, subscribeLxmusicEvents } from './lxmusicTransport';
import { isLxMusicInfo, LXMUSIC_PROVIDER_ID, lxMusicIdOf, lxMusicInfoOf, lxSongOriginOf, normalizeLxmusicSong, withLxCover, type LxMusicInfo } from './lxmusicNormalize';
import { readLxCoverUrl } from './lxmusicCover';

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
        volume: Math.min(1, Math.max(0, finiteOr(state.volume, 1))),
        muted: state.mute === true,
        loopMode: lxLoopModeOf(typeof state.playMode === 'string' ? state.playMode : ''),
        queueRevision: String(state.queueRev ?? ''),
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
    const later = answer.playLater.filter(isLxMusicInfo).map(info => normalizeLxmusicSong(info));
    const index = currentId ? list.findIndex(song => song.id === currentId) : -1;
    if (index >= 0) return [...list.slice(0, index + 1), ...later, ...list.slice(index + 1)];
    const head = current ? [normalizeLxmusicSong(current)] : [];
    return [...head, ...later.filter(song => song.id !== currentId), ...list];
};

export function createLxmusicExternalPlayback(): OnlineExternalPlaybackProvider {
    /** 最近一次读到的洛雪状态。 */
    let lastState: LxPlayerState | null = null;
    /** 洛雪自己换到的这首：下一次 play 它时不重新开始，接着放（follow 之后 Folia 的 playSong 会来 play）。 */
    let handoffId: string | null = null;
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
        return withLxCover(song, await readLxCoverUrl(state.musicInfo).catch(() => null));
    };

    return {
        leadsPlayback: true,
        canPlay: song => {
            try { lxMusicInfoOf(song); return true; } catch { return false; }
        },
        isPrepared: song => {
            try { return handoffId === lxMusicIdOf(song); } catch { return false; }
        },
        async play(song, startSec) {
            const id = lxMusicIdOf(song);
            // 洛雪自己换到了这首（follow）：它已经在放，什么都不用做
            if (handoffId === id) {
                handoffId = null;
                return;
            }
            handoffId = null;
            const info = lxMusicInfoOf(song);
            const seconds = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
            // 洛雪已经停在这首上（Folia 重开后点播放、点了正在放的那首）：接着放，不从头开始。现读一次，旧的状态可能已经换了歌
            const state = await readState().catch(() => null);
            if (state?.musicId === id) {
                if (seconds > 0 && Math.abs(state.positionMs / 1000 - seconds) > 2) await control('seek', seconds);
                await control('play');
                console.info('[LxMusic] resumed the song LX Music already has');
                return;
            }
            const origin = lxSongOriginOf(song);
            const target = origin.share
                ? { target: 'songlist', text: origin.share.text, source: origin.share.source, musicId: id }
                : origin.listId
                    ? { target: 'list', listId: origin.listId, musicId: id }
                    : { target: 'search', musicInfo: info };
            await requestLxmusic('play', target);
            if (seconds > 1) await control('seek', seconds);
            console.info('[LxMusic] play started', { target: target.target });
        },
        // 窗口重建后新窗口接着跟：洛雪那边什么都不用动
        adopt() {
            handoffId = null;
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
            handoffId = song.id as string;
            return { song, queue: queue.length ? queue : [song] };
        },
        async getQueue() {
            return await readQueue(lastState ?? await readState());
        },
        watchPlayer(tell) {
            // 洛雪推来的状态：开始放一首（换了歌，或者从暂停到播放）时告诉一声
            let toldKey = '';
            return subscribeLxmusicEvents(event => {
                if (event.type !== 'state') return;
                const state = event.data as LxPlayerState;
                let status: ProviderExternalPlaybackStatus;
                try { status = lxExternalStatusOf(state); } catch { return; }
                lastState = state;
                const key = status.isPlaying ? status.mediaId : '';
                if (key === toldKey) return;
                toldKey = key;
                if (key) tell(status);
            });
        },
    };
}
