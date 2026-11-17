import type { SongResult, UnifiedSong } from '../../../types';
import type {
    MediaId, OnlineCatalogProvider, OnlineLibraryProvider, OnlineMutationProvider, OnlineSearchProvider, ProviderCollection, ProviderPage,
} from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { requestLxmusic } from './lxmusicTransport';
import {
    LX_LOVE_LIST_ID, LX_TEMP_LIST_ID, LXMUSIC_PROVIDER_ID, isLxAccountInfo, isLxMusicInfo, lxMusicIdOf, lxMusicInfoOf, normalizeLxAccountLists, normalizeLxShareList,
    normalizeLxmusicList, normalizeLxmusicSong, parseAccountCollectionId, parseShareCollectionId, slicePage, type LxAccountInfo, type LxAccountListRef, type LxListInfo,
} from './lxmusicNormalize';

// src/services/onlineMusic/lxmusic/lxmusicLibrary.ts
// 洛雪的我的列表、我的收藏、搜索和分享歌单。
// 我的列表在 Folia 里就是这个平台的歌单：试听列表、我的收藏、自建列表（含从歌单收藏来的）；红心改的是「我的收藏」。
// 分享歌单（洛雪「打开分享的歌单」：各平台的歌单链接或 ID，平台由洛雪按链接认）的集合 id 是 `share:<平台>:<链接或 ID>`，
// 在 Folia 的搜索框里贴链接、或者命令面板「打开分享的歌单」都会打开它；「收藏」在洛雪里新建一个我的列表。
// 搜歌单按关键词搜洛雪里各平台的歌单，搜到的也按分享歌单打开。
// 洛雪「平台音乐」里登录着的平台账号的歌单和每日推荐排在我的列表后面，只读，集合 id 见 accountCollectionId。

/** 洛雪单个平台一页 30 首：Folia 的 offset 按这个换成洛雪的页码。 */
export const LX_SEARCH_PAGE_SIZE = 30;
/** 搜歌单时洛雪单个平台一页的条数：Folia 的 offset 按这个换成洛雪的页码。 */
export const LX_SONGLIST_SEARCH_PAGE_SIZE = 15;
/** 读整张列表的结果留多久：翻页、刷新时不必每页都从洛雪读一遍整张列表。 */
const LIST_KEEP_MS = 15_000;
/**
 * 平台账号的歌单要去平台读，慢，读过的留一会儿：账号和歌单目录留得短（在洛雪里登录、退出平台后很快看得到），
 * 歌单里的歌留得长一些（翻页、回到歌单时不必再等一遍）。
 */
const ACCOUNT_DIRECTORY_KEEP_MS = 30_000;
const ACCOUNT_SONGS_KEEP_MS = 60_000;

interface LxSearchAnswer { list: unknown[]; page: number; maxPage: number; total: number }
interface LxSongListItem { id: string; source: string; name: string; img?: string; author?: string; desc?: string; total?: unknown; play_count?: unknown }
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

const accountKey = (ref: LxAccountListRef) => `acct:${JSON.stringify([ref.accountId, ref.daily === true, ref.playlistId ?? '', ref.dirId ?? ''])}`;

const readAccountSongs = async (ref: LxAccountListRef): Promise<UnifiedSong[]> => {
    const key = accountKey(ref);
    const kept = keptLists.get(key);
    if (kept && Date.now() - kept.at < ACCOUNT_SONGS_KEEP_MS) return kept.songs;
    const params = ref.daily
        ? { accountId: ref.accountId, daily: true }
        : { accountId: ref.accountId, playlistId: ref.playlistId, ...(ref.dirId ? { dirId: ref.dirId } : {}) };
    const answer = await requestLxmusic<{ list?: unknown[] } | null>('accountListMusics', params);
    const songs = (answer?.list ?? []).filter(isLxMusicInfo).map(info => normalizeLxmusicSong(info, { account: true }));
    keptLists.set(key, { at: Date.now(), songs });
    return songs;
};

let keptAccounts: { at: number; accounts: LxAccountInfo[] } | null = null;

/**
 * 洛雪里登录着的平台账号和它们的歌单。洛雪还不认这个接口（旧版本）时抛错。
 * 没有账号、或有账号没读出来时不留：刚在洛雪里登录、平台恢复了，下一次读就看得到。
 */
const readAccounts = async (): Promise<LxAccountInfo[]> => {
    if (keptAccounts && Date.now() - keptAccounts.at < ACCOUNT_DIRECTORY_KEEP_MS) return keptAccounts.accounts;
    const answer: unknown = await requestLxmusic('accountLists');
    const accounts = Array.isArray(answer) ? answer.filter(isLxAccountInfo) : [];
    for (const account of accounts) {
        if (account.error) console.warn('[LxMusic] the playlists of a platform account could not be read', { source: account.source, error: account.error });
    }
    keptAccounts = accounts.length && accounts.every(account => !account.error) ? { at: Date.now(), accounts } : null;
    return accounts;
};

/** 我的列表后面接着平台账号的歌单；账号这边读不出来（洛雪没登平台、版本旧、平台出错）时只列我的列表。 */
const readAccountCollections = async (): Promise<ProviderCollection[]> => {
    try {
        return (await readAccounts()).flatMap(normalizeLxAccountLists);
    } catch (error) {
        console.warn('[LxMusic] the platform account playlists could not be read', error);
        return [];
    }
};

/** 洛雪一张我的列表、一张分享歌单里歌的顺序（id）：起播时和 Folia 交来的队列比一比（lxmusicPlayback.ts）。 */
export const readLxListSongIds = async (listId: string): Promise<string[]> => (await readListSongs(listId)).map(song => String(song.id));
export const readLxShareSongIds = async (source: string, text: string): Promise<string[]> => (await readShareSongs(source, text)).map(song => String(song.id));

/**
 * 列表变了（洛雪推来新的版本号）：留着的整张我的列表作废（分享歌单、平台账号歌单里的歌不是我的列表，不动），
 * 平台账号和歌单目录也重读（便宜，顺便跟上在洛雪里登录、退出的平台）。
 */
export const forgetKeptLxLists = () => {
    for (const key of [...keptLists.keys()]) if (!key.startsWith('share:') && !key.startsWith('acct:')) keptLists.delete(key);
    keptAccounts = null;
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

let sourceNames: Promise<Map<string, string>> | null = null;

/** 洛雪各平台的名字（info 接口，用洛雪自己的叫法），给歌单标上是哪个平台的；读不到时不标，下次再读。 */
const readLxSourceNames = (): Promise<Map<string, string>> => {
    sourceNames ??= requestLxmusic<{ sources?: Array<{ id?: unknown; name?: unknown }> } | null>('info').then(info => {
        const names = new Map((info?.sources ?? []).flatMap(item => (
            typeof item.id === 'string' && typeof item.name === 'string' ? [[item.id, item.name] as const] : []
        )));
        // 一个名字也没读到不留着，下次再读
        if (!names.size) sourceNames = null;
        return names;
    }, (error: unknown) => {
        sourceNames = null;
        console.warn('[LxMusic] the platform names could not be read', error);
        return new Map<string, string>();
    });
    return sourceNames;
};

/** 打开一张分享歌单：读第一页的信息，回它的集合。认不出平台时要给 source。 */
export async function openLxShareList(text: string, source?: string): Promise<ProviderCollection> {
    const [detail, names] = await Promise.all([
        requestLxmusic<LxSongListDetail>('songlistDetail', { text, ...(source ? { source } : {}), page: 1 }),
        readLxSourceNames(),
    ]);
    return normalizeLxShareList(detail.source, detail.id, detail.info, detail.total, names.get(detail.source));
}

const isLxSongListItem = (value: unknown): value is LxSongListItem => {
    const item = value as Partial<Record<keyof LxSongListItem, unknown>> | null;
    return typeof item === 'object' && item !== null && typeof item.id === 'string' && item.id !== ''
        && typeof item.source === 'string' && item.source !== '' && typeof item.name === 'string';
};

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
    // 贴进来的是链接：按分享歌单打开它。否则照洛雪搜索页的「歌单」按关键词搜各平台（单曲的平台选择只管单曲），
    // 搜到的按分享歌单打开
    async searchPlaylists(query, _limit, offset): Promise<ProviderPage<ProviderCollection>> {
        const text = query.trim();
        if (looksLikeShareLink(text)) {
            if (offset > 0) return { items: [], total: 0, nextOffset: offset, hasMore: false };
            try {
                return { items: [await openLxShareList(text)], total: 1, nextOffset: 1, hasMore: false };
            } catch (error) {
                console.warn('[LxMusic] the pasted song list could not be opened', error);
                return { items: [], total: 0, nextOffset: offset, hasMore: false };
            }
        }
        if (!text) return { items: [], total: 0, nextOffset: offset, hasMore: false };
        const page = Math.floor(Math.max(0, offset) / LX_SONGLIST_SEARCH_PAGE_SIZE) + 1;
        const [answer, names] = await Promise.all([
            requestLxmusic<LxSearchAnswer | null>('songlistSearch', { text, source: 'all', page }),
            readLxSourceNames(),
        ]);
        const items = (answer?.list ?? []).filter(isLxSongListItem)
            .map(item => normalizeLxShareList(item.source, item.id, item, item.total, names.get(item.source)));
        return {
            items,
            ...(answer?.total ? { total: answer.total } : {}),
            nextOffset: page * LX_SONGLIST_SEARCH_PAGE_SIZE,
            hasMore: items.length > 0 && page < (answer?.maxPage ?? 0),
        };
    },
};

export const lxmusicLibrary: OnlineLibraryProvider = {
    async getUserPlaylists(_userId, limit, offset) {
        const [lists, accountLists] = await Promise.all([readLists(), readAccountCollections()]);
        return slicePage([...lists.map(normalizeLxmusicList), ...accountLists], limit, offset);
    },
    async getLikedSongIds() {
        // 整张「我的收藏」：读不出来就抛，不能回一张空的整表（那样喜欢的歌都会被当成取消了）
        const ids: unknown = await requestLxmusic('likedIds');
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
            throw new OnlineProviderError('invalid-response', 'LX Music liked song ids are invalid', LXMUSIC_PROVIDER_ID);
        }
        return { ids: ids as string[], whole: true };
    },
    // 「我的收藏」有几首：回到 Folia 窗口时比一下（account/readMoments.ts），在洛雪里收藏、取消收藏后 Folia 才重读
    async getLikedSongCount() {
        const ids: unknown = await requestLxmusic('likedIds');
        return Array.isArray(ids) ? ids.length : null;
    },
};

export const lxmusicCatalog: OnlineCatalogProvider = {
    async getPlaylistTracks(id, limit, offset) {
        const share = parseShareCollectionId(id);
        const account = share ? null : parseAccountCollectionId(id);
        const songs = share
            ? await readShareSongs(share.source, share.text)
            : account ? await readAccountSongs(account) : await readListSongs(String(id));
        return slicePage(songs, limit, offset);
    },
    async getPlaylistDetail(id, collection) {
        const share = parseShareCollectionId(id);
        if (share) return await openLxShareList(share.text, share.source);
        if (parseAccountCollectionId(id)) {
            return (await readAccountCollections()).find(item => item.id === String(id)) ?? collection ?? null;
        }
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
    // 平台账号的歌单只读（加歌、删歌到洛雪的「平台音乐」里做）
    canAddToPlaylist: playlist => playlist.providerId === LXMUSIC_PROVIDER_ID && !parseShareCollectionId(playlist.id)
        && !parseAccountCollectionId(playlist.id) && playlist.id !== LX_TEMP_LIST_ID && playlist.id !== LX_LOVE_LIST_ID,
    canEditPlaylistTracks: playlist => !parseShareCollectionId(playlist.id) && !parseAccountCollectionId(playlist.id) && playlist.id !== LX_TEMP_LIST_ID,
    async updatePlaylistTracks(operation, playlist, tracks) {
        const listId = listIdOf(playlist);
        if (parseShareCollectionId(listId)) throw new OnlineProviderError('unsupported', 'A shared song list cannot be edited', LXMUSIC_PROVIDER_ID);
        if (parseAccountCollectionId(listId)) throw new OnlineProviderError('unsupported', 'A platform account playlist is edited in LX Music', LXMUSIC_PROVIDER_ID);
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
