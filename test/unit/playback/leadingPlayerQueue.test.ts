import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/playback/leadingPlayerQueue.test.ts
// 外部播放器主导时的队列：就地编辑挡下并说一声；能排进播放器队列的只有和正在放的同一个平台的歌；
// 交给播放器之后按结果说一声。不在这条路线上什么都不挡。

const mocks = vi.hoisted(() => ({
    leading: false,
    playing: null as SongResult | null,
    canQueue: vi.fn<(song: SongResult) => boolean>(() => true),
    queueIn: vi.fn<(songs: SongResult[], position: 'next' | 'end') => Promise<void>>(() => Promise.resolve()),
    setStatusMessage: vi.fn(),
}));

vi.mock('@/services/onlineMusic/externalPlayback', () => ({
    isLeadingExternalRoute: () => mocks.leading,
    getExternalSong: () => mocks.playing,
}));
vi.mock('@/services/onlineMusic/omni', () => ({
    omni: { canQueueInExternalPlayer: mocks.canQueue, queueInExternalPlayer: mocks.queueIn },
}));
vi.mock('@/stores/useStatusMessageStore', () => ({ setStatusMessage: mocks.setStatusMessage }));

const { queueInLeadingPlayer, refuseLeadingQueueEdit, songsForLeadingPlayer } = await import('@/components/app/playback/leadingPlayerQueue');

const song = (id: string, providerId: string): SongResult => ({
    id, name: id, artists: [], album: { id: 'a', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId, mediaId: id },
} as SongResult);

const t = (key: string) => key;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
    mocks.leading = false;
    mocks.playing = null;
    mocks.canQueue.mockReset();
    mocks.canQueue.mockImplementation(() => true);
    mocks.queueIn.mockReset();
    mocks.queueIn.mockImplementation(() => Promise.resolve());
    mocks.setStatusMessage.mockReset();
});

describe('leadingPlayerQueue', () => {
    it('stands aside where no external player leads', () => {
        expect(refuseLeadingQueueEdit(t)).toBe(false);
        expect(songsForLeadingPlayer([song('kw_1', 'lxmusic')])).toBeNull();
        expect(mocks.setStatusMessage).not.toHaveBeenCalled();
    });

    it('refuses in-place edits while a player leads, and says so', () => {
        mocks.leading = true;
        expect(refuseLeadingQueueEdit(t)).toBe(true);
        expect(mocks.setStatusMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', text: 'status.leadingPlayerOwnsQueue' }));
    });

    it('queues only the songs of the provider that plays', () => {
        mocks.leading = true;
        mocks.playing = song('kw_0', 'lxmusic');
        const mine = song('kw_1', 'lxmusic');
        expect(songsForLeadingPlayer([mine, song('1', 'netease')])).toEqual([mine]);
    });

    it('hands the songs to the player and tells how it went', async () => {
        const songs = [song('kw_1', 'lxmusic')];
        queueInLeadingPlayer(songs, 'end', t);
        await flush();
        expect(mocks.queueIn).toHaveBeenCalledWith(songs, 'end');
        expect(mocks.setStatusMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'success', text: 'status.added_to_play_queue' }));

        mocks.queueIn.mockImplementation(() => Promise.reject(new Error('no')));
        queueInLeadingPlayer(songs, 'next', t);
        await flush();
        expect(mocks.setStatusMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error', text: 'status.leadingPlayerQueueFailed' }));

        queueInLeadingPlayer([], 'next', t);
        expect(mocks.setStatusMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'info', text: 'status.leadingPlayerCannotQueue' }));
        expect(mocks.queueIn).toHaveBeenCalledTimes(2);
    });
});
