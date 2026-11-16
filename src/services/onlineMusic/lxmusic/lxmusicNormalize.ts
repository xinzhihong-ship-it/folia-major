import type { SongResult, UnifiedSong } from '../../../types';
import type { JsonValue, ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/lxmusic/lxmusicNormalize.ts
// 洛雪的歌曲信息（LX.Music.MusicInfo）、我的列表、分享歌单换成 Folia 的歌和集合。
// 每首歌把洛雪的原始歌曲信息整份放进 `sourceRef.providerData.musicInfo`：播放、加入列表、取歌词都把它原样交回洛雪。

export const LXMUSIC_PROVIDER_ID = 'lxmusic';

/** 洛雪的歌曲信息（只列用到的字段）。 */
export interface LxMusicInfo {
    id: string;
    name: string;
    singer: string;
    source: string;
    interval: string | null;
    meta: {
        songId?: string | number;
        albumName?: string;
        albumId?: string | number;
        picUrl?: string | null;
        [key: string]: unknown;
    };
}

/** 我的列表一项（洛雪主进程的 lists 接口）。 */
export interface LxListInfo {
    id: string;
    name: string;
    kind: 'default' | 'love' | 'user';
    count: number;
    source?: string | null;
    sourceListId?: string | null;
}

/** 在哪个列表里读到这首歌、它来自哪张分享歌单、或者它排在洛雪的稍后播放里：播放时据此决定在洛雪里怎么放。 */
export interface LxSongOrigin {
    listId?: string | null;
    share?: { source: string; text: string };
    later?: boolean;
}

const SHARE_PREFIX = 'share:';
/** 洛雪「试听列表」「我的收藏」「临时列表」的 id。 */
export const LX_DEFAULT_LIST_ID = 'default';
export const LX_LOVE_LIST_ID = 'love';
export const LX_TEMP_LIST_ID = 'temp';

export const isLxMusicInfo = (value: unknown): value is LxMusicInfo => {
    if (typeof value !== 'object' || value === null) return false;
    const info = value as Partial<Record<keyof LxMusicInfo, unknown>>;
    return typeof info.id === 'string' && info.id !== '' && typeof info.name === 'string'
        && typeof info.source === 'string' && typeof info.meta === 'object' && info.meta !== null;
};

/** 「03:45」「1:02:03」换成毫秒；没有时长回 0。 */
export const parseLxInterval = (interval: string | null | undefined): number => {
    if (!interval) return 0;
    const parts = interval.split(':').map(part => Number(part));
    if (!parts.length || parts.some(part => !Number.isFinite(part) || part < 0)) return 0;
    return Math.round(parts.reduce((total, part) => total * 60 + part, 0) * 1000);
};

/** 洛雪把多位歌手写在一串里（「周杰伦、方文山」「A & B」）。 */
const splitSingers = (singer: string): string[] => singer
    .split(/\s*(?:、|&|\/|，|,|;|；)\s*/)
    .map(name => name.trim())
    .filter(Boolean);

const httpCover = (url: unknown): string | undefined => (
    typeof url === 'string' && /^https?:\/\//i.test(url) ? url : undefined
);

/** 洛雪的一首歌换成 Folia 的歌。歌手按名字认（洛雪没有歌手页）。 */
export const normalizeLxmusicSong = (raw: unknown, origin: LxSongOrigin = {}): UnifiedSong => {
    const existing = raw as Partial<UnifiedSong> | null;
    if (existing?.sourceRef?.kind === 'online' && existing.sourceRef.providerId === LXMUSIC_PROVIDER_ID) return existing as UnifiedSong;
    if (!isLxMusicInfo(raw)) throw new OnlineProviderError('invalid-response', 'LX Music song info is malformed', LXMUSIC_PROVIDER_ID);
    const info = raw;
    const singers = splitSingers(typeof info.singer === 'string' ? info.singer : '');
    const albumName = typeof info.meta.albumName === 'string' ? info.meta.albumName : '';
    const providerData: Record<string, JsonValue> = { musicInfo: info as unknown as JsonValue, source: info.source };
    if (origin.listId) providerData.listId = origin.listId;
    if (origin.share) providerData.share = { source: origin.share.source, text: origin.share.text };
    if (origin.later) providerData.later = true;
    return {
        id: info.id,
        name: info.name,
        artists: singers.map(name => ({ id: name, name })),
        album: {
            id: info.meta.albumId != null && info.meta.albumId !== '' ? String(info.meta.albumId) : albumName,
            name: albumName,
            ...(httpCover(info.meta.picUrl) ? { coverUrl: httpCover(info.meta.picUrl) } : {}),
        },
        durationMs: parseLxInterval(info.interval),
        sourceRef: { kind: 'online', providerId: LXMUSIC_PROVIDER_ID, mediaId: info.id, providerData },
    };
};

const sourceRefOf = (song: SongResult) => (
    song.sourceRef?.kind === 'online' && song.sourceRef.providerId === LXMUSIC_PROVIDER_ID ? song.sourceRef : null
);

/** 这首歌的洛雪歌曲信息；不是洛雪的歌抛 unsupported。 */
export const lxMusicInfoOf = (song: SongResult): LxMusicInfo => {
    const info = sourceRefOf(song)?.providerData?.musicInfo;
    if (!isLxMusicInfo(info)) throw new OnlineProviderError('unsupported', 'Song does not belong to LX Music', LXMUSIC_PROVIDER_ID);
    return info;
};

export const lxMusicIdOf = (song: SongResult): string => {
    const ref = sourceRefOf(song);
    if (!ref) throw new OnlineProviderError('unsupported', 'Song does not belong to LX Music', LXMUSIC_PROVIDER_ID);
    return ref.mediaId;
};

export const lxSongOriginOf = (song: SongResult): LxSongOrigin => {
    const data = sourceRefOf(song)?.providerData;
    const share = data?.share as { source?: unknown; text?: unknown } | undefined;
    return {
        listId: typeof data?.listId === 'string' ? data.listId : null,
        ...(share && typeof share.source === 'string' && typeof share.text === 'string' ? { share: { source: share.source, text: share.text } } : {}),
        ...(data?.later === true ? { later: true } : {}),
    };
};

/** 封面另读到了：换上它（歌曲列表里没带封面的歌，播放时才去问洛雪）。 */
export const withLxCover = (song: UnifiedSong, coverUrl: string | null): UnifiedSong => (
    coverUrl && !song.album.coverUrl ? { ...song, album: { ...song.album, coverUrl } } : song
);

/** 我的列表一项换成集合。「我的收藏」是喜欢的歌（红心走 likeSong）。 */
export const normalizeLxmusicList = (list: LxListInfo): ProviderCollection => ({
    providerId: LXMUSIC_PROVIDER_ID,
    id: list.id,
    name: list.name,
    type: 'playlist',
    trackCount: list.count,
    isOwned: true,
    ...(list.kind === 'love' ? { isLiked: true } : {}),
    providerData: {
        kind: list.kind,
        ...(list.source ? { source: list.source } : {}),
        ...(list.sourceListId ? { sourceListId: list.sourceListId } : {}),
    },
});

/** 分享歌单的集合 id：`share:<平台>:<链接或 ID>`。 */
export const shareCollectionId = (source: string, text: string) => `${SHARE_PREFIX}${source}:${text}`;

export const parseShareCollectionId = (id: unknown): { source: string; text: string } | null => {
    if (typeof id !== 'string' || !id.startsWith(SHARE_PREFIX)) return null;
    const rest = id.slice(SHARE_PREFIX.length);
    const colon = rest.indexOf(':');
    if (colon <= 0 || colon === rest.length - 1) return null;
    return { source: rest.slice(0, colon), text: rest.slice(colon + 1) };
};

/** 分享歌单的信息（洛雪 songlistDetail 的 info）换成集合。 */
export const normalizeLxShareList = (source: string, text: string, info: { name?: unknown; img?: unknown; desc?: unknown; author?: unknown; play_count?: unknown } | null | undefined, total?: unknown): ProviderCollection => {
    const count = Number(total);
    return {
        providerId: LXMUSIC_PROVIDER_ID,
        id: shareCollectionId(source, text),
        name: typeof info?.name === 'string' && info.name ? info.name : text,
        type: 'playlist',
        ...(httpCover(info?.img) ? { coverUrl: httpCover(info?.img) } : {}),
        ...(typeof info?.desc === 'string' && info.desc ? { description: info.desc } : {}),
        ...(typeof info?.author === 'string' && info.author ? { creator: { id: info.author, nickname: info.author } } : {}),
        ...(Number.isFinite(count) && count >= 0 ? { trackCount: count } : {}),
        isOwned: false,
        providerData: { share: { source, text } },
    };
};

/** 把一整份列表按 offset / limit 切一页。 */
export const slicePage = <T>(items: T[], limit: number, offset: number): ProviderPage<T> => {
    const page = items.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return { items: page, total: items.length, nextOffset, hasMore: nextOffset < items.length };
};
