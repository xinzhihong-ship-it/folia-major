import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/lxmusic/lxmusicLibrary.test.ts
// 洛雪的搜索与我的收藏：单曲搜索按选着的平台（context.scope）收窄，能选的平台是洛雪里能搜歌的那几家；
// 贴进来的链接按分享歌单打开；「我的收藏」读不出整张列表时抛错，不回一张空的整表。

const requests = vi.hoisted(() => ({ calls: [] as Array<{ operation: string; params: Record<string, unknown> }>, answers: new Map<string, unknown>() }));

vi.mock('@/services/onlineMusic/lxmusic/lxmusicTransport', () => ({
    requestLxmusic: vi.fn((operation: string, params: Record<string, unknown> = {}) => {
        requests.calls.push({ operation, params });
        return Promise.resolve(requests.answers.get(operation) ?? null);
    }),
    subscribeLxmusicEvents: vi.fn(() => () => {}),
}));

const { lxmusicLibrary, lxmusicSearch } = await import('@/services/onlineMusic/lxmusic/lxmusicLibrary');

const info = (id: string) => ({ id, name: id, singer: 'A', source: 'kw', interval: '03:00', meta: { albumName: '' } });

beforeEach(() => {
    requests.calls.length = 0;
    requests.answers.clear();
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

    it('opens a pasted share link as a song list, and finds no list by plain words', async () => {
        requests.answers.set('songlistDetail', { source: 'wy', id: '123', info: { name: '歌单' }, list: [], page: 1, limit: 30, total: 12 });
        const pasted = await lxmusicSearch.searchPlaylists?.('https://music.163.com/playlist?id=123', 30, 0);
        expect(pasted?.items.map(item => [item.id, item.name])).toEqual([['share:wy:123', '歌单']]);
        requests.calls.length = 0;
        expect((await lxmusicSearch.searchPlaylists?.('晴天', 30, 0))?.items).toEqual([]);
        expect(requests.calls).toEqual([]);
    });
});

describe('LX Music liked songs', () => {
    it('answers the whole list it read', async () => {
        requests.answers.set('likedIds', ['kw_1', 'tx_2']);
        expect(await lxmusicLibrary.getLikedSongIds?.('lxmusic-local')).toEqual({ ids: ['kw_1', 'tx_2'], whole: true });
    });

    it('throws rather than answer an empty whole list when the reply is not a list', async () => {
        requests.answers.set('likedIds', { oops: true });
        await expect(lxmusicLibrary.getLikedSongIds?.('lxmusic-local')).rejects.toMatchObject({ code: 'invalid-response' });
    });
});
