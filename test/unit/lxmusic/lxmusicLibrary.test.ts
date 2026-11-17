import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/lxmusic/lxmusicLibrary.test.ts
// 洛雪的搜索与我的收藏：单曲搜索按选着的平台（context.scope）收窄，能选的平台是洛雪里能搜歌的那几家；
// 贴进来的链接按分享歌单打开，关键词按洛雪搜歌单；「我的收藏」读不出整张列表时抛错，不回一张空的整表；
// 洛雪登录着的平台账号的歌单接在我的列表后面，只读，读歌带上账号和歌单。

const requests = vi.hoisted(() => ({ calls: [] as Array<{ operation: string; params: Record<string, unknown> }>, answers: new Map<string, unknown>() }));

vi.mock('@/services/onlineMusic/lxmusic/lxmusicTransport', () => ({
    requestLxmusic: vi.fn((operation: string, params: Record<string, unknown> = {}) => {
        requests.calls.push({ operation, params });
        return Promise.resolve(requests.answers.get(operation) ?? null);
    }),
    subscribeLxmusicEvents: vi.fn(() => () => {}),
}));

const { forgetKeptLxLists, lxmusicCatalog, lxmusicLibrary, lxmusicMutations, lxmusicSearch } = await import('@/services/onlineMusic/lxmusic/lxmusicLibrary');

const info = (id: string) => ({ id, name: id, singer: 'A', source: 'kw', interval: '03:00', meta: { albumName: '' } });

beforeEach(() => {
    requests.calls.length = 0;
    requests.answers.clear();
    forgetKeptLxLists();
});

describe('LX Music search', () => {
    it('searches the picked platform, or all of them', async () => {
        requests.answers.set('search', { list: [info('kw_1')], page: 1, maxPage: 2, total: 40 });
        const narrowed = await lxmusicSearch.searchSongs('a', 30, 0, { scope: 'kw' });
        await lxmusicSearch.searchSongs('a', 30, 30);
        expect(requests.calls.map(call => call.params)).toEqual([
            { text: 'a', source: 'kw', page: 1 },
            { text: 'a', source: 'all', page: 2 },
        ]);
        expect(narrowed).toMatchObject({ total: 40, nextOffset: 30, hasMore: true });
        expect(narrowed.items.map(song => song.id)).toEqual(['kw_1']);
    });

    it('offers the platforms LX Music can search, in its own names', async () => {
        requests.answers.set('info', { sources: [
            { id: 'kw', name: '酷我音乐', search: true },
            { id: 'local', name: '本地', search: false },
            { id: 7, name: 'bad', search: true },
        ] });
        expect(await lxmusicSearch.getScopes?.()).toEqual([{ id: 'kw', name: '酷我音乐' }]);
    });

    it('opens a pasted share link as a song list', async () => {
        requests.answers.set('songlistDetail', { source: 'wy', id: '123', info: { name: '歌单' }, list: [], page: 1, limit: 30, total: 12 });
        const pasted = await lxmusicSearch.searchPlaylists?.('https://music.163.com/playlist?id=123', 30, 0);
        expect(pasted?.items.map(item => [item.id, item.name])).toEqual([['share:wy:123', '歌单']]);
        expect(requests.calls.map(call => call.operation)).toEqual(['songlistDetail']);
    });

    it('searches the song lists of every platform by words, each opened as a shared list', async () => {
        requests.answers.set('songlistSearch', { list: [
            { id: 'id_9', source: 'kg', name: '梁博精选', img: 'https://img/9.jpg', author: '某人', total: '42' },
            { id: '', source: 'wy', name: 'bad' },
        ], page: 1, maxPage: 3, total: 300 });
        const first = await lxmusicSearch.searchPlaylists?.(' 梁博 ', 30, 0);
        await lxmusicSearch.searchPlaylists?.('梁博', 30, first?.nextOffset ?? 0);
        expect(requests.calls.map(call => call.params)).toEqual([
            { text: '梁博', source: 'all', page: 1 },
            { text: '梁博', source: 'all', page: 2 },
        ]);
        expect(first).toMatchObject({ total: 300, hasMore: true });
        expect(first?.items).toEqual([expect.objectContaining({
            id: 'share:kg:id_9', name: '梁博精选', coverUrl: 'https://img/9.jpg', trackCount: 42, creator: { id: '某人', nickname: '某人' },
        })]);
    });
});

describe('LX Music platform account playlists', () => {
    const account = {
        id: 'kg_7', source: 'kg', sourceName: '平台甲', nickname: '陌小辛', daily: '每日推荐',
        playlists: [{ id: '2', name: '我喜欢', img: 'https://img/2.jpg', total: '15', dirId: 'd:1' }, { id: '', name: 'bad' }],
    };

    it('come after My Lists, the daily list first, named with the platform', async () => {
        requests.answers.set('lists', [{ id: 'love', name: '我的收藏', kind: 'love', count: 3 }]);
        requests.answers.set('accountLists', [account, { id: 'broken' }]);
        const page = await lxmusicLibrary.getUserPlaylists(0, 50, 0);
        expect(page.items.map(item => [item.id, item.name])).toEqual([
            ['love', '我的收藏'],
            ['acct:kg_7:daily', '平台甲 · 每日推荐'],
            ['acct:kg_7:list:d%3A1:2', '平台甲 · 我喜欢'],
        ]);
        expect(page.items[2]).toMatchObject({ coverUrl: 'https://img/2.jpg', trackCount: 15, isOwned: false });
        const playlist = page.items[2];
        expect(lxmusicMutations.canAddToPlaylist?.(playlist)).toBe(false);
        expect(lxmusicMutations.canEditPlaylistTracks?.(playlist)).toBe(false);
    });

    it('reads the accounts again when none were signed in, and after LX Music says its lists changed', async () => {
        const names = async () => (await lxmusicLibrary.getUserPlaylists(0, 50, 0)).items.map(item => item.name);
        requests.answers.set('lists', []);
        requests.answers.set('accountLists', []);
        expect(await names()).toEqual([]);
        // Signed in to a platform in LX Music meanwhile: an empty answer was not kept
        requests.answers.set('accountLists', [account]);
        expect(await names()).toEqual(['平台甲 · 每日推荐', '平台甲 · 我喜欢']);
        // Kept for a while now; LX Music's lists event reads them again
        requests.answers.set('accountLists', []);
        expect(await names()).toHaveLength(2);
        forgetKeptLxLists();
        expect(await names()).toEqual([]);
    });

    it('reads the songs of an account playlist or daily list, marked as from an account', async () => {
        requests.answers.set('accountListMusics', { list: [info('kg_a'), { bad: true }] });
        const tracks = await lxmusicCatalog.getPlaylistTracks!('acct:kg_7:list:d%3A1:2', 50, 0);
        await lxmusicCatalog.getPlaylistTracks!('acct:kg_7:daily', 50, 0);
        expect(requests.calls.filter(call => call.operation === 'accountListMusics').map(call => call.params)).toEqual([
            { accountId: 'kg_7', playlistId: '2', dirId: 'd:1' },
            { accountId: 'kg_7', daily: true },
        ]);
        expect(tracks.items.map(song => [song.id, song.sourceRef?.kind === 'online' ? song.sourceRef.providerData?.account : null])).toEqual([['kg_a', true]]);
    });
});

describe('LX Music liked songs', () => {
    it('answers the whole list it read', async () => {
        requests.answers.set('likedIds', ['kw_1', 'tx_2']);
        expect(await lxmusicLibrary.getLikedSongIds?.('lxmusic-local')).toEqual({ ids: ['kw_1', 'tx_2'], whole: true });
    });

    it('counts the liked list so a change made in LX Music is read again when the app is returned to', async () => {
        requests.answers.set('likedIds', ['kw_1', 'tx_2', 'wy_3']);
        expect(await lxmusicLibrary.getLikedSongCount?.('lxmusic-local')).toBe(3);
        requests.answers.set('likedIds', null);
        expect(await lxmusicLibrary.getLikedSongCount?.('lxmusic-local')).toBeNull();
    });

    it('throws rather than answer an empty whole list when the reply is not a list', async () => {
        requests.answers.set('likedIds', { oops: true });
        await expect(lxmusicLibrary.getLikedSongIds?.('lxmusic-local')).rejects.toMatchObject({ code: 'invalid-response' });
    });
});
