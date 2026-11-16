import type { SongResult } from '../../../types';
import { getExternalSong, isLeadingExternalRoute } from '../../../services/onlineMusic/externalPlayback';
import { omni } from '../../../services/onlineMusic/omni';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { getOnlineProviderIdForSong } from '../../../utils/appPlaybackGuards';

// src/components/app/playback/leadingPlayerQueue.ts
// 外部播放器主导播放时（externalPlayback 的 leadsPlayback），队列是播放器的：应用的队列照着它
// （useExternalPlaybackBridge 的 mirrorQueue），在这里改顺序、删歌，下一次照着它时又会回去，播放器也不知道。
// 所以就地编辑（删除、移到末尾、拖动、打乱、清空）在这条路线上不做，只说一声；「下一首播放」「加入队列」
// 交给播放器自己的队列（queueInPlayer），之后的队列由它照回来。

type Translate = (key: string) => string;

/** 播放器主导时就地编辑不做，说一声；回 true 表示挡下了。 */
export const refuseLeadingQueueEdit = (t: Translate): boolean => {
    if (!isLeadingExternalRoute()) return false;
    setStatusMessage({ type: 'info', text: t('status.leadingPlayerOwnsQueue'), nonce: Date.now(), durationMs: 2400 });
    return true;
};

/** 播放器主导时，排不进它队列的歌（本地、Navidrome）不加进应用的队列：说一声放不进；回 true 表示挡下了。 */
export const refuseForeignQueueAdd = (t: Translate): boolean => {
    if (!isLeadingExternalRoute()) return false;
    setStatusMessage({ type: 'info', text: t('status.leadingPlayerCannotQueue'), nonce: Date.now(), durationMs: 2400 });
    return true;
};

/** 播放器主导时，这几首里它能排进自己队列的（和正在放的同一个平台）；不在这条路线上回 null。 */
export const songsForLeadingPlayer = (songs: SongResult[]): SongResult[] | null => {
    if (!isLeadingExternalRoute()) return null;
    const playing = getExternalSong();
    const providerId = playing ? getOnlineProviderIdForSong(playing) : null;
    if (!providerId) return [];
    return songs.filter(song => getOnlineProviderIdForSong(song) === providerId && omni.canQueueInExternalPlayer(song));
};

/**
 * 交给播放器的队列：`next` 排在正在放的这首后面，`end` 排在已经等着的那些后面；结果说一声。`quiet` 时成功不说
 * （调用方自己有提示），失败照样说。
 */
export const queueInLeadingPlayer = (songs: SongResult[], position: 'next' | 'end', t: Translate, { quiet = false }: { quiet?: boolean } = {}): void => {
    if (songs.length === 0) {
        setStatusMessage({ type: 'info', text: t('status.leadingPlayerCannotQueue'), nonce: Date.now(), durationMs: 2400 });
        return;
    }
    void omni.queueInExternalPlayer(songs, position).then(() => {
        console.info('[LeadingPlayerQueue] queued in the external player', { count: songs.length, position });
        if (quiet) return;
        setStatusMessage({
            type: 'success',
            text: t(position === 'next' ? 'status.added_to_next_play' : 'status.added_to_play_queue'),
            nonce: Date.now(),
            durationMs: 1200,
        });
    }, (error: unknown) => {
        console.warn('[LeadingPlayerQueue] the external player did not take the songs', error);
        setStatusMessage({ type: 'error', text: t('status.leadingPlayerQueueFailed'), nonce: Date.now() });
    });
};
