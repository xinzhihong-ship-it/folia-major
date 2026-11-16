import { describe, expect, it } from 'vitest';
import {
    lxMusicIdOf, lxMusicInfoOf, lxSongOriginOf, normalizeLxShareList, normalizeLxmusicList, normalizeLxmusicSong, parseLxInterval,
    parseShareCollectionId, shareCollectionId, slicePage, withLxCover,
} from '@/services/onlineMusic/lxmusic/lxmusicNormalize';
import { OnlineProviderError } from '@/types/onlineMusic';
import { parseSharedListInput } from '@/components/command-palette/commands/sharedListCommand';

// test/unit/lxmusic/lxmusicNormalize.test.ts
// 洛雪的歌曲信息、我的列表、分享歌单换成 Folia 的歌和集合。

const info = (overrides: Record<string, unknown> = {}) => ({
    id: 'kw_123', name: '晴天', singer: '周杰伦、方文山', source: 'kw', interval: '04:29',
    meta: { songId: '123', albumName: '叶惠美', albumId: '9', picUrl: 'https://img.example/c.jpg', qualitys: [] },
    ...overrides,
});

describe('LX Music songs', () => {
    it('keeps the whole song info for LX Music and splits the singers', () => {
        const song = normalizeLxmusicSong(info(), { listId: 'love' });
        expect(song.id).toBe('kw_123');
        expect(song.name).toBe('晴天');
        expect(song.artists.map(artist => artist.name)).toEqual(['周杰伦', '方文山']);
        expect(song.album).toEqual({ id: '9', name: '叶惠美', coverUrl: 'https://img.example/c.jpg' });
        expect(song.durationMs).toBe(269000);
        expect(song.sourceRef).toMatchObject({ kind: 'online', providerId: 'lxmusic', mediaId: 'kw_123', providerData: { listId: 'love', source: 'kw' } });
        expect(lxMusicInfoOf(song)).toEqual(info());
        expect(lxMusicIdOf(song)).toBe('kw_123');
        expect(lxSongOriginOf(song)).toEqual({ listId: 'love' });
    });

    it('remembers which shared list a song came from', () => {
        const song = normalizeLxmusicSong(info(), { share: { source: 'wy', text: 'https://example/playlist?id=1' } });
        expect(lxSongOriginOf(song)).toEqual({ listId: null, share: { source: 'wy', text: 'https://example/playlist?id=1' } });
    });

    it('leaves out a cover that is no web address, and takes one read later', () => {
        const song = normalizeLxmusicSong(info({ meta: { albumName: '', picUrl: 'C:\\cover.jpg' } }));
        expect(song.album.coverUrl).toBeUndefined();
        expect(withLxCover(song, 'data:image/png;base64,AA').album.coverUrl).toBe('data:image/png;base64,AA');
        expect(withLxCover(normalizeLxmusicSong(info()), 'https://other').album.coverUrl).toBe('https://img.example/c.jpg');
    });

    it('reads durations of hours, and none', () => {
        expect(parseLxInterval('1:02:03')).toBe(3723000);
        expect(parseLxInterval(null)).toBe(0);
        expect(parseLxInterval('ab:cd')).toBe(0);
    });

    it('refuses what is not a song info, and a song of another platform', () => {
        expect(() => normalizeLxmusicSong({ id: 'x' })).toThrow(OnlineProviderError);
        const other = { id: '1', name: 'x', artists: [], album: { id: '', name: '' }, durationMs: 0, sourceRef: { kind: 'online' as const, providerId: 'netease', mediaId: '1' } };
        expect(() => lxMusicInfoOf(other)).toThrow(OnlineProviderError);
    });

    it('passes a song already normalized through', () => {
        const song = normalizeLxmusicSong(info());
        expect(normalizeLxmusicSong(song)).toBe(song);
    });
});

describe('LX Music lists', () => {
    it('makes My Lists playlists, the loved one liked', () => {
        expect(normalizeLxmusicList({ id: 'love', name: '我的收藏', kind: 'love', count: 3 })).toMatchObject({
            providerId: 'lxmusic', id: 'love', type: 'playlist', trackCount: 3, isOwned: true, isLiked: true,
        });
        expect(normalizeLxmusicList({ id: 'userlist_1', name: 'A', kind: 'user', count: 0, source: 'wy', sourceListId: '1' }).providerData)
            .toEqual({ kind: 'user', source: 'wy', sourceListId: '1' });
    });

    it('names a shared list by its source and link, and reads the id back', () => {
        const id = shareCollectionId('tx', 'https://y.example/playlist/8:1');
        expect(parseShareCollectionId(id)).toEqual({ source: 'tx', text: 'https://y.example/playlist/8:1' });
        expect(parseShareCollectionId('love')).toBeNull();
        expect(parseShareCollectionId('share:tx:')).toBeNull();
        const list = normalizeLxShareList('tx', '8', { name: '夜', img: 'https://img/p.jpg', desc: '', author: 'someone' }, 120);
        expect(list).toMatchObject({ id: 'share:tx:8', name: '夜', coverUrl: 'https://img/p.jpg', trackCount: 120, isOwned: false, creator: { nickname: 'someone' } });
        expect(normalizeLxShareList('tx', '8', null).name).toBe('8');
    });

    it('slices a whole list into pages', () => {
        expect(slicePage([1, 2, 3, 4, 5], 2, 2)).toEqual({ items: [3, 4], total: 5, nextOffset: 4, hasMore: true });
        expect(slicePage([1, 2, 3], 5, 0)).toEqual({ items: [1, 2, 3], total: 3, nextOffset: 3, hasMore: false });
    });
});

describe('the shared list command input', () => {
    const sources = [{ id: 'wy', name: '网易音乐' }, { id: 'tx', name: 'QQ音乐' }];

    it('takes a link as it is, or a platform and an id', () => {
        expect(parseSharedListInput('分享歌单 https://music.example/playlist?id=1 ', sources)).toEqual({ text: '分享歌单 https://music.example/playlist?id=1' });
        expect(parseSharedListInput('wy 123456', sources)).toEqual({ text: '123456', source: 'wy' });
        expect(parseSharedListInput('QQ音乐 789', sources)).toEqual({ text: '789', source: 'tx' });
        expect(parseSharedListInput('123456', sources)).toBeNull();
        expect(parseSharedListInput('xx 123', sources)).toBeNull();
        expect(parseSharedListInput('  ', sources)).toBeNull();
    });
});
