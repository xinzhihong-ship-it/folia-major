import type { SongResult, UnifiedSong } from '../../../types';
import type {
    MediaId, OnlineCatalogProvider, OnlineLibraryProvider, OnlineMutationProvider, OnlineSearchProvider, ProviderCollection, ProviderPage,
} from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { requestLxmusic } from './lxmusicTransport';
import {
    LX_LOVE_LIST_ID, LX_TEMP_LIST_ID, LXMUSIC_PROVIDER_ID, isLxMusicInfo, lxMusicIdOf, lxMusicInfoOf, normalizeLxShareList, normalizeLxmusicList, normalizeLxmusicSong,
    parseShareCollectionId, slicePage, type LxListInfo,
} from './lxmusicNormalize';

// src/services/onlineMusic/lxmusic/lxmusicLibrary.ts
// 洛雪的我的列表、我的收藏、搜索和分享歌单。
// 我的列表在 Folia 里就是这个平台的歌单：试听列表、我的收藏、自建列表（含从歌单收藏来的）；红心改的是「我的收藏」。
// 分享歌单（洛雪「打开分享的歌单」：各平台的歌单链接或 ID，平台由洛雪按链接认）的集合 id 是 `share:<平台>:<链接或 ID>`，
// 在 Folia 的搜索框里贴链接、或者命令面板「打开分享的歌单」都会打开它；「收藏」在洛雪里新建一个我的列表。

/** 洛雪单个平台一页 30 首：Folia 的 offset 按这个换成洛雪的页码。 */
export const LX_SEARCH_PAGE_SIZE = 30;
/** 读整张列表的结果留多久：翻页、刷新时不必每页都从洛雪读一遍整张列表。 */
const LIST_KEEP_MS = 15_000;

interface LxSearchAnswer { list: unknown[]; page: number; maxPage: number; total: number }
interface LxSongListDetail { source: string; id: string; info: Record<string, unknown> | null; list: unknown[]; page: number; limit: number; total: number }

const keptLists = new Map<string, { at: number; songs: UnifiedSong[] }>();

const readListSongs = async (listId: string): Promise<UnifiedSong[]> => {
    const kept = keptLists.get(listId);
    if (kept && Date.now() - kept.at < LIST_KEEP_MS) return kept.songs;
    const list = await requestLxmusic<unknown[]>('listMusics', { listId });
    const songs = (Array.isArray(list) ? list : []).filter(isLxMusicInfo).map(info => normalizeLxmusicSong(info, { listId }));
    keptLists.set(listId, { at: Date.now(), songs });
    return songs;
};

const readShareSongs = async (source: string, text: string): Promise<UnifiedSong[]> => {
    const key = `share:${source}:${text}`;
    const kept = keptLists.get(key);
    if (kept && Date.now() - kept.at < LIST_KEEP_MS * 20) return kept.songs;
    const answer = await requestLxmusic<{ list?: unknown[] } | null>('songlistAll', { text, source });
    const songs = (answer?.list ?? []).filter(isLxMusicInfo).map(info => normalizeLxmusicSong(info, { share: { source, text } }));
    keptLists.set(key, { at: Date.now(), songs });
    return songs;
};

/** 列表变了（洛雪推来新的版本号）：留着的整张列表作废。 */
export const forgetKeptLxLists = () => {
    for (const key of [...keptLists.keys()]) if (!key.startsWith('share:')) keptLists.delete(key);
};

const readLists = async (): Promise<LxListInfo[]> => {
    const lists = await requestLxmusic<LxListInfo[]>('lists');
    return Array.isArray(lists) ? lists : [];
};

const listIdOf = (playlist: MediaId | ProviderCollection) => String(typeof playlist === 'object' ? playlist.id : playlist);

const musicInfosOf = (tracks: Array<MediaId | SongResult>) => tracks.map(track => {
    if (typeof track === 'object') return lxMusicInfoOf(track);
    throw new OnlineProviderError('unsupported', 'LX Music needs the whole song to add it to a list', LXMUSIC_PROVIDER_ID);
});

/** 一段文字里有没有链接（贴进搜索框时试着打开那张歌单；是哪个平台的、认不认得，洛雪说了算）。 */
export const looksLikeShareLink = (query: string) => /https?:\/\/\S+/i.test(query);

/** 打开一张分享歌单：读第一页的信息，回它的集合。认不出平台时要给 source。 */
export async function openLxShareList(text: string, source?: string): Promise<ProviderCollection> {
    const detail = await requestLxmusic<LxSongListDetail>('songlistDetail', { text, ...(source ? { source } : {}), page: 1 });
    return normalizeLxShareList(detail.source, detail.id, detail.info, detail.total);
}

/** 洛雪里能搜歌的平台（名字用洛雪自己的）。 */
const readLxSearchScopes = async (): Promise<Array<{ id: string; name: string }>> => {
    const info = await requestLxmusic<{ sources?: Array<{ id?: unknown; name?: unknown; search?: unknown }> } | null>('info');
    return (info?.sources ?? []).flatMap(source => (
        source.search === true && typeof source.id === 'string' && typeof source.name === 'string' ? [{ id: source.id, name: source.name }] : []
    ));
};

export const lxmusicSearch: OnlineSearchProvider = {
    // 搜一个平台（context.scope 是洛雪的平台 id），没选时照洛雪「全部」：各平台合并去重
    async searchSongs(query, _limit, offset, context) {
        const text = query.trim();
        if (!text) return { items: [], total: 0, nextOffset: offset, hasMore: false };
        const page = Math.floor(Math.max(0, offset) / LX_SEARCH_PAGE_SIZE) + 1;
        const answer = await requestLxmusic<LxSearchAnswer | null>('search', { text, source: context?.scope || 'all', page });
        const items = (answer?.list ?? []).filter(isLxMusicInfo).map(info => normalizeLxmusicSong(info));
        const nextOffset = page * LX_SEARCH_PAGE_SIZE;
        return { items, ...(answer?.total ? { total: answer.total } : {}), nextOffset, hasMore: items.length > 0 && page < (answer?.maxPage ?? 0) };
    },
    getScopes: readLxSearchScopes,
    // 搜歌单只认贴进来的分享链接：洛雪没有按关键词搜歌单的接口
    async searchPlaylists(query, _limit, offset): Promise<ProviderPage<ProviderCollection>> {
        if (offset > 0 || !looksLikeShareLink(query)) return { items: [], total: 0, nextOffset: offset, hasMore: false };
        try {
            return { items: [await openLxShareList(query.trim())], total: 1, nextOffset: 1, hasMore: false };
        } catch (error) {
            console.warn('[LxMusic] the pasted song list could not be opened', error);
            return { items: [], total: 0, nextOffset: offset, hasMore: false };
        }
    },
};

export const lxmusicLibrary: OnlineLibraryProvider = {
    async getUserPlaylists(_userId, limit, offset) {
        return slicePage((await readLists()).map(normalizeLxmusicList), limit, offset);
    },
    async getLikedSongIds() {
        // 整张「我的收藏」：读不出来就抛，不能回一张空的整表（那样喜欢的歌都会被当成取消了）
        const ids: unknown = await requestLxmusic('likedIds');
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
            throw new OnlineProviderError('invalid-response', 'LX Music liked song ids are invalid', LXMUSIC_PROVIDER_ID);
        }
        return { ids: ids as string[], whole: true };
    },
};

export const lxmusicCatalog: OnlineCatalogProvider = {
    async getPlaylistTracks(id, limit, offset) {
        const share = parseShareCollectionId(id);
        const songs = share ? await readShareSongs(share.source, share.text) : await readListSongs(String(id));
        return slicePage(songs, limit, offset);
    },
    async getPlaylistDetail(id, collection) {
        const share = parseShareCollectionId(id);
        if (share) return await openLxShareList(share.text, share.source);
        const list = (await readLists()).find(item => item.id === String(id));
        return list ? normalizeLxmusicList(list) : collection ?? null;
    },
    // 命令面板「打开分享的歌单」：链接由洛雪认平台，只有 ID 时给 source
    openSharedCollection: (text, source) => openLxShareList(text.trim(), source),
    // 只有 ID 时能选的平台：洛雪里有分享歌单接口的那几个，名字用洛雪自己的
    async getSharedCollectionSources() {
        const info = await requestLxmusic<{ sources?: Array<{ id?: unknown; name?: unknown; songList?: unknown }> } | null>('info');
        return (info?.sources ?? []).flatMap(source => (
            source.songList === true && typeof source.id === 'string' && typeof source.name === 'string' ? [{ id: source.id, name: source.name }] : []
        ));
    },
    // 分享歌单收藏过没有：我的列表里有没有从它收藏来的
    async getSubscriptionStatus(type, id) {
        const share = type === 'playlist' ? parseShareCollectionId(id) : null;
        if (!share) return false;
        return (await readLists()).some(list => list.source === share.source && list.sourceListId === share.text);
    },
};

export const lxmusicMutations: OnlineMutationProvider = {
    async likeSong(song, liked) {
        if (typeof song !== 'object') throw new OnlineProviderError('unsupported', 'LX Music needs the whole song to love it', LXMUSIC_PROVIDER_ID);
        if (liked) await requestLxmusic('listAdd', { listId: LX_LOVE_LIST_ID, musicInfos: [lxMusicInfoOf(song)] });
        else await requestLxmusic('listRemove', { listId: LX_LOVE_LIST_ID, ids: [lxMusicIdOf(song)] });
        keptLists.delete(LX_LOVE_LIST_ID);
    },
    // 能加歌的是我的列表（不含临时列表）；「我的收藏」走红心
    canAddToPlaylist: playlist => playlist.providerId === LXMUSIC_PROVIDER_ID && !parseShareCollectionId(playlist.id)
        && playlist.id !== LX_TEMP_LIST_ID && playlist.id !== LX_LOVE_LIST_ID,
    canEditPlaylistTracks: playlist => !parseShareCollectionId(playlist.id) && playlist.id !== LX_TEMP_LIST_ID,
    async updatePlaylistTracks(operation, playlist, tracks) {
        const listId = listIdOf(playlist);
        if (parseShareCollectionId(listId)) throw new OnlineProviderError('unsupported', 'A shared song list cannot be edited', LXMUSIC_PROVIDER_ID);
        if (operation === 'add') await requestLxmusic('listAdd', { listId, musicInfos: musicInfosOf(tracks) });
        else await requestLxmusic('listRemove', { listId, ids: tracks.map(track => (typeof track === 'object' ? lxMusicIdOf(track) : String(track))) });
        keptLists.delete(listId);
    },
    canSubscribe: collection => Boolean(parseShareCollectionId(collection.id)),
    // 收藏分享歌单：在洛雪里新建一个我的列表（读整张歌单，可能要一会儿）。取消收藏不在这里删列表，到洛雪里删
    async subscribePlaylist(playlist, subscribed) {
        const share = parseShareCollectionId(listIdOf(playlist));
        if (!share) throw new OnlineProviderError('unsupported', 'Only a shared song list can be collected', LXMUSIC_PROVIDER_ID);
        if (!subscribed) throw new OnlineProviderError('unsupported', 'Remove the collected list in LX Music', LXMUSIC_PROVIDER_ID);
        const name = typeof playlist === 'object' && playlist.name !== share.text ? playlist.name : undefined;
        const result = await requestLxmusic<{ listId: string; name: string; existed: boolean } | null>('songlistCollect', { text: share.text, source: share.source, ...(name ? { name } : {}) });
        console.info('[LxMusic] collected the shared song list', { existed: result?.existed === true });
    },
};
