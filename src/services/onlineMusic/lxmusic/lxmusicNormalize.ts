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

/**
 * 在哪个列表里读到这首歌、它来自哪张分享歌单、它排在洛雪的稍后播放里、或者它来自平台账号的歌单（account）：
 * 播放时据此决定在洛雪里怎么放。
 */
export interface LxSongOrigin {
    listId?: string | null;
    share?: { source: string; text: string };
    later?: boolean;
    account?: boolean;
}

/** 洛雪里登录着的一个平台账号和它的歌单（洛雪 accountLists 接口，「平台音乐」左边那一列）。 */
export interface LxAccountInfo {
    id: string;
    source: string;
    /** 平台的名字，用洛雪自己的叫法。 */
    sourceName: string;
    nickname: string;
    /** 每日推荐的名字；这个平台没有每日推荐时是 null。 */
    daily: string | null;
    playlists: LxAccountPlaylist[];
    error?: string;
}

export interface LxAccountPlaylist {
    id: string;
    name: string;
    img?: string | null;
    desc?: string | null;
    total?: string | number | null;
    dirId?: string | null;
}

/** 平台账号的一张歌单（playlistId，有的平台还有 dirId），或它的每日推荐（daily）。 */
export interface LxAccountListRef {
    accountId: string;
    daily?: boolean;
    playlistId?: string;
    dirId?: string;
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
    if (origin.account) providerData.account = true;
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
        ...(data?.account === true ? { account: true } : {}),
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

/**
 * 分享歌单、搜到的歌单的信息（洛雪 songlistDetail 的 info、songlistSearch 的一项）换成集合。
 * 创建者一栏写上平台（`sourceName`，如「<平台> · 作者」）：搜到的歌单来自各个平台，要看得出是哪家的。
 */
export const normalizeLxShareList = (
    source: string,
    text: string,
    info: { name?: unknown; img?: unknown; desc?: unknown; author?: unknown; play_count?: unknown } | null | undefined,
    total?: unknown,
    sourceName?: string,
): ProviderCollection => {
    const count = Number(total);
    const author = typeof info?.author === 'string' ? info.author : '';
    const byline = [sourceName, author].filter(Boolean).join(' · ');
    return {
        providerId: LXMUSIC_PROVIDER_ID,
        id: shareCollectionId(source, text),
        name: typeof info?.name === 'string' && info.name ? info.name : text,
        type: 'playlist',
        ...(httpCover(info?.img) ? { coverUrl: httpCover(info?.img) } : {}),
        ...(typeof info?.desc === 'string' && info.desc ? { description: info.desc } : {}),
        ...(byline ? { creator: { id: author || source, nickname: byline } } : {}),
        ...(Number.isFinite(count) && count >= 0 ? { trackCount: count } : {}),
        isOwned: false,
        providerData: { share: { source, text } },
    };
};

const ACCOUNT_PREFIX = 'acct:';

/**
 * 平台账号歌单的集合 id：`acct:<账号>:list:<目录>:<歌单>`，每日推荐是 `acct:<账号>:daily`；各段 encodeURIComponent，
 * 读歌时从 id 就能拿回洛雪要的参数。
 */
export const accountCollectionId = (ref: LxAccountListRef): string => {
    const account = encodeURIComponent(ref.accountId);
    if (ref.daily) return `${ACCOUNT_PREFIX}${account}:daily`;
    return `${ACCOUNT_PREFIX}${account}:list:${encodeURIComponent(ref.dirId ?? '')}:${encodeURIComponent(ref.playlistId ?? '')}`;
};

export const parseAccountCollectionId = (id: unknown): LxAccountListRef | null => {
    if (typeof id !== 'string' || !id.startsWith(ACCOUNT_PREFIX)) return null;
    const parts = id.slice(ACCOUNT_PREFIX.length).split(':');
    try {
        const accountId = decodeURIComponent(parts[0] ?? '');
        if (!accountId) return null;
        if (parts.length === 2 && parts[1] === 'daily') return { accountId, daily: true };
        if (parts.length !== 4 || parts[1] !== 'list') return null;
        const playlistId = decodeURIComponent(parts[3]);
        if (!playlistId) return null;
        const dirId = decodeURIComponent(parts[2]);
        return { accountId, playlistId, ...(dirId ? { dirId } : {}) };
    } catch {
        return null;
    }
};

const isLxAccountPlaylist = (value: unknown): value is LxAccountPlaylist => {
    const playlist = value as Partial<Record<keyof LxAccountPlaylist, unknown>> | null;
    return typeof playlist === 'object' && playlist !== null && typeof playlist.id === 'string' && playlist.id !== ''
        && typeof playlist.name === 'string';
};

/** 账号本身的字段对不对；它的歌单逐张在 normalizeLxAccountLists 里挑，一张不对不连累整个账号。 */
export const isLxAccountInfo = (value: unknown): value is LxAccountInfo => {
    const account = value as Partial<Record<keyof LxAccountInfo, unknown>> | null;
    return typeof account === 'object' && account !== null && typeof account.id === 'string' && account.id !== ''
        && typeof account.sourceName === 'string' && typeof account.nickname === 'string'
        && (account.daily === null || typeof account.daily === 'string')
        && Array.isArray(account.playlists);
};

/**
 * 一个平台账号的歌单换成集合：每日推荐在前，再是它的歌单。名字前面写上平台（「<平台> · 我喜欢」），和洛雪自己的列表分得开；
 * 只读：加歌、删歌、收藏都不做（到洛雪的「平台音乐」里做）。
 */
export const normalizeLxAccountLists = (account: LxAccountInfo): ProviderCollection[] => {
    const owner = { id: account.id, nickname: `${account.sourceName} · ${account.nickname}` };
    const providerData = { account: { accountId: account.id, source: account.source } };
    const daily: ProviderCollection[] = account.daily ? [{
        providerId: LXMUSIC_PROVIDER_ID,
        id: accountCollectionId({ accountId: account.id, daily: true }),
        name: `${account.sourceName} · ${account.daily}`,
        type: 'playlist',
        creator: owner,
        isOwned: false,
        providerData,
    }] : [];
    return [...daily, ...account.playlists.filter(isLxAccountPlaylist).map((playlist): ProviderCollection => {
        const count = Number(playlist.total);
        return {
            providerId: LXMUSIC_PROVIDER_ID,
            id: accountCollectionId({ accountId: account.id, playlistId: playlist.id, ...(playlist.dirId ? { dirId: playlist.dirId } : {}) }),
            name: `${account.sourceName} · ${playlist.name}`,
            type: 'playlist',
            ...(httpCover(playlist.img) ? { coverUrl: httpCover(playlist.img) } : {}),
            ...(typeof playlist.desc === 'string' && playlist.desc ? { description: playlist.desc } : {}),
            ...(playlist.total != null && playlist.total !== '' && Number.isFinite(count) && count >= 0 ? { trackCount: count } : {}),
            creator: owner,
            isOwned: false,
            providerData,
        };
    })];
};

/** 把一整份列表按 offset / limit 切一页。 */
export const slicePage = <T>(items: T[], limit: number, offset: number): ProviderPage<T> => {
    const page = items.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return { items: page, total: items.length, nextOffset, hasMore: nextOffset < items.length };
};
