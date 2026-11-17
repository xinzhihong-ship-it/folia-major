import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LxPlayerState } from '@/services/onlineMusic/lxmusic/lxmusicPlayback';

// test/unit/lxmusic/lxmusicPlayback.test.ts
// 洛雪放歌、Folia 跟着：状态换算、队列拼法，以及 play / follow 交给洛雪的请求。

const requests = vi.hoisted(() => ({ calls: [] as Array<{ operation: string; params: Record<string, unknown> }>, answers: new Map<string, unknown>() }));

vi.mock('@/services/onlineMusic/lxmusic/lxmusicTransport', () => ({
    requestLxmusic: vi.fn(async (operation: string, params: Record<string, unknown> = {}) => {
        requests.calls.push({ operation, params });
        const answer = requests.answers.get(operation);
        return typeof answer === 'function' ? (answer as (p: unknown) => unknown)(params) : answer ?? null;
    }),
    subscribeLxmusicEvents: vi.fn(() => () => {}),
}));

const { composeLxQueue, createLxmusicExternalPlayback, lxExternalStatusOf, lxLoopModeOf, lxQualityChoicesOf, lxQualityLabelOf, lxQualityOf } = await import('@/services/onlineMusic/lxmusic/lxmusicPlayback');
const { normalizeLxmusicSong } = await import('@/services/onlineMusic/lxmusic/lxmusicNormalize');

const info = (id: string) => ({ id, name: id, singer: 'A', source: 'kw', interval: '03:00', meta: { albumName: '', picUrl: 'https://c/' + id } });

const state = (overrides: Partial<LxPlayerState> = {}): LxPlayerState => ({
    musicId: 'kw_1', musicInfo: info('kw_1'), listId: 'love', isTempPlay: false, playLaterCount: 0,
    isPlay: true, loading: false, positionMs: 1000, durationMs: 180000, rate: 1, volume: 0.5, mute: false,
    playMode: 'listLoop', quality: { wanted: 'flac', current: 'flac', actual: '' }, queueRev: 3, listsRev: 1, loveRev: 1,
    ...overrides,
});

describe('LX Music status', () => {
    it('becomes what the external route reads', () => {
        expect(lxExternalStatusOf(state())).toEqual({
            mediaId: 'kw_1', isPlaying: true, positionMs: 1000, durationMs: 180000, ended: false,
            rate: 1, volume: 0.5, muted: false, loopMode: 'all', shuffle: false, queueRevision: '3', quality: 'lossless', qualityLabel: 'FLAC',
        });
        expect(lxExternalStatusOf(state({ playMode: 'random' }))).toMatchObject({ loopMode: 'all', shuffle: true });
    });

    it('leaves out what LX Music did not say, so nothing of the app is set from a guess', () => {
        const status = lxExternalStatusOf({ musicId: 'kw_1', isPlay: true });
        expect(status).toEqual({ mediaId: 'kw_1', isPlaying: true, positionMs: 0, durationMs: 0, ended: false, rate: 1 });
    });

    it('is loading, not playing, while LX Music fetches the song', () => {
        expect(lxExternalStatusOf(state({ loading: true }))).toMatchObject({ isPlaying: false, starting: true });
    });

    it('has no track when LX Music has none', () => {
        expect(lxExternalStatusOf(state({ musicId: null }))).toMatchObject({ mediaId: '', isPlaying: false, positionMs: 0 });
    });

    it('refuses an answer it cannot read', () => {
        expect(() => lxExternalStatusOf({} as LxPlayerState)).toThrow();
    });

    it('maps the play modes and qualities', () => {
        expect(['listLoop', 'random', 'list', 'singleLoop', 'none'].map(lxLoopModeOf)).toEqual(['all', 'all', 'off', 'one', 'off']);
        expect(lxQualityLabelOf({ current: '320k', actual: 'flac' })).toBe('FLAC');
        expect(lxQualityLabelOf({ current: 'master' })).toBe('Master');
        expect(lxQualityLabelOf({})).toBeUndefined();
        expect(lxQualityOf({ wanted: '320k' })).toBe('high');
        expect(lxQualityOf({ wanted: 'master' })).toBe('hires');
        expect(lxQualityOf({ wanted: 'local' })).toBeUndefined();
    });

    it('reads LX Music own quality levels, and none from an older LX Music that does not give them', () => {
        expect(lxQualityChoicesOf({ quality: 'master', qualities: [{ id: '128k', name: '128K 普音' }, { id: 'master', name: '臻品母带' }, { id: 7 }] })).toEqual({
            choices: [{ id: '128k', label: '128K 普音' }, { id: 'master', label: '臻品母带' }], current: 'master',
        });
        expect(lxQualityChoicesOf({ quality: 'flac' })).toBeNull();
        expect(lxQualityChoicesOf(null)).toBeNull();
    });

    it('lists LX Music quality levels only while the app is connected to it', async () => {
        const choices = createLxmusicExternalPlayback().qualityChoices!;
        requests.answers.set('info', { quality: 'flac', qualities: [{ id: 'flac', name: 'FLAC 无损' }] });
        requests.answers.set('linkStatus', { linked: false, connected: true });
        expect(await choices.read()).toBeNull();
        requests.answers.set('linkStatus', { linked: true, connected: true });
        expect(await choices.read()).toEqual({ choices: [{ id: 'flac', label: 'FLAC 无损' }], current: 'flac' });
    });

    it('hears each LX Music quality setting, and when LX Music is reached or lost', async () => {
        const { subscribeLxmusicEvents } = await import('@/services/onlineMusic/lxmusic/lxmusicTransport');
        let push: (event: unknown) => void = () => {};
        vi.mocked(subscribeLxmusicEvents).mockImplementationOnce(listener => { push = listener as (event: unknown) => void; return () => {}; });
        const heard: unknown[] = [];
        createLxmusicExternalPlayback().qualityChoices!.watch(event => { heard.push(event); });
        push({ type: 'state', data: state({ quality: { wanted: 'master', current: 'flac', actual: '' } }) });
        push({ type: 'state', data: state({ quality: { wanted: '', current: '', actual: '' } }) });
        push({ type: 'lists', data: {} });
        push({ type: 'connection', data: { connected: false } });
        expect(heard).toEqual([{ type: 'setting', current: 'master' }, { type: 'reachable', reachable: false }]);
    });
});

describe('LX Music queue', () => {
    it('puts the play-later songs after the current one', () => {
        const queue = composeLxQueue({ listId: 'love', isTempPlay: false, tempListId: null, list: [info('a'), info('b'), info('c')], playLater: [info('x')] }, 'b', null);
        expect(queue.map(song => song.id)).toEqual(['a', 'b', 'x', 'c']);
        expect(queue[0].sourceRef).toMatchObject({ providerData: { listId: 'love' } });
        expect(queue[2].sourceRef).toMatchObject({ providerData: { later: true } });
    });

    it('puts a play-later current song first', () => {
        const queue = composeLxQueue({ listId: 'love', isTempPlay: true, tempListId: null, list: [info('a'), info('b')], playLater: [info('x'), info('y')] }, 'x', info('x'));
        expect(queue.map(song => song.id)).toEqual(['x', 'y', 'a', 'b']);
    });
});

describe('LX Music playback', () => {
    beforeEach(() => {
        requests.calls.length = 0;
        requests.answers.clear();
        requests.answers.set('status', state({ musicId: 'kw_9', musicInfo: info('kw_9') }));
    });

    const playOps = () => requests.calls.filter(call => call.operation === 'play' || call.operation === 'control').map(call => call.params);

    it('plays a song of My Lists from that list', async () => {
        const player = createLxmusicExternalPlayback();
        await player.play(normalizeLxmusicSong(info('kw_1'), { listId: 'love' }), 0);
        expect(playOps()).toEqual([{ target: 'list', listId: 'love', musicId: 'kw_1' }]);
    });

    it('plays a search result as LX Music does: into the trial list', async () => {
        const player = createLxmusicExternalPlayback();
        await player.play(normalizeLxmusicSong(info('kw_1')), 42);
        expect(playOps()).toEqual([{ target: 'search', musicInfo: info('kw_1') }, { action: 'seek', value: 42 }]);
    });

    it('plays a song of a shared list from that list', async () => {
        const player = createLxmusicExternalPlayback();
        await player.play(normalizeLxmusicSong(info('kw_1'), { share: { source: 'wy', text: 'link' } }), 0);
        expect(playOps()).toEqual([{ target: 'songlist', text: 'link', source: 'wy', musicId: 'kw_1' }]);
    });

    it('plays from the list when the queue is that list, the play-later songs and a partly read list included', async () => {
        requests.answers.set('listMusics', [info('kw_1'), info('kw_2'), info('kw_3')]);
        const player = createLxmusicExternalPlayback();
        const inList = (id: string) => normalizeLxmusicSong(info(id), { listId: 'mine_a' });
        const later = normalizeLxmusicSong(info('kw_8'), { later: true });
        await player.play(inList('kw_2'), 0, { queue: [inList('kw_1'), inList('kw_2'), later, inList('kw_3')] });
        await player.play(inList('kw_1'), 0, { queue: [inList('kw_1'), inList('kw_2')] });
        expect(playOps()).toEqual([
            { target: 'list', listId: 'mine_a', musicId: 'kw_2' },
            { target: 'list', listId: 'mine_a', musicId: 'kw_1' },
        ]);
    });

    it('hands a shuffled, filtered or added-to queue to LX Music as it stands', async () => {
        requests.answers.set('listMusics', [info('kw_1'), info('kw_2'), info('kw_3')]);
        const player = createLxmusicExternalPlayback();
        const inList = (id: string) => normalizeLxmusicSong(info(id), { listId: 'mine_b' });
        const other = { ...inList('x'), sourceRef: { kind: 'online' as const, providerId: 'netease', mediaId: '1' } };
        await player.play(inList('kw_3'), 0, { queue: [inList('kw_3'), inList('kw_1'), other, inList('kw_2')] });
        expect(playOps()).toEqual([
            { target: 'queue', musicInfos: [info('kw_3'), info('kw_1'), info('kw_2')], musicId: 'kw_3' },
        ]);
    });

    it('plays a song of a platform account playlist by handing LX Music the queue, as its platform music page does', async () => {
        const player = createLxmusicExternalPlayback();
        const fromAccount = (id: string) => normalizeLxmusicSong(info(id), { account: true });
        await player.play(fromAccount('kw_2'), 0, { queue: [fromAccount('kw_1'), fromAccount('kw_2')] });
        await player.play(fromAccount('kw_5'), 0);
        expect(playOps()).toEqual([
            { target: 'queue', musicInfos: [info('kw_1'), info('kw_2')], musicId: 'kw_2' },
            { target: 'search', musicInfo: info('kw_5') },
        ]);
        expect(requests.calls.some(call => call.operation === 'listMusics')).toBe(false);
    });

    it('plays a play-later song from the play-later list, without changing the playing list', async () => {
        const player = createLxmusicExternalPlayback();
        await player.play(normalizeLxmusicSong(info('kw_1'), { later: true }), 0);
        expect(playOps()).toEqual([{ target: 'later', musicInfos: [info('kw_1')], now: true }]);
    });

    it('resumes the song LX Music already has instead of starting it again', async () => {
        requests.answers.set('status', state({ musicId: 'kw_1', positionMs: 5000, isPlay: false }));
        const player = createLxmusicExternalPlayback();
        await player.play(normalizeLxmusicSong(info('kw_1'), { listId: 'love' }), 60);
        expect(playOps()).toEqual([{ action: 'seek', value: 60 }, { action: 'play' }]);
    });

    it('follows the track LX Music moved to, and does not start it again', async () => {
        requests.answers.set('status', state({ musicId: 'kw_2', musicInfo: info('kw_2'), listId: 'love' }));
        requests.answers.set('queue', { listId: 'love', isTempPlay: false, tempListId: null, list: [info('kw_1'), info('kw_2')], playLater: [] });
        const player = createLxmusicExternalPlayback();
        const status = lxExternalStatusOf(state({ musicId: 'kw_2', musicInfo: info('kw_2') }));
        const target = await player.follow!(status);
        expect(target?.song.id).toBe('kw_2');
        expect(target?.queue.map(song => song.id)).toEqual(['kw_1', 'kw_2']);
        expect(player.isPrepared!(target!.song)).toBe(true);
        requests.calls.length = 0;
        await player.play(target!.song, 0);
        expect(playOps()).toEqual([]);
    });

    it('plays a followed song for real once LX Music has moved on from it', async () => {
        requests.answers.set('status', state({ musicId: 'kw_2', musicInfo: info('kw_2'), listId: 'love' }));
        requests.answers.set('queue', { listId: 'love', isTempPlay: false, tempListId: null, list: [info('kw_1'), info('kw_2')], playLater: [] });
        const player = createLxmusicExternalPlayback();
        const target = await player.follow!(lxExternalStatusOf(state({ musicId: 'kw_2', musicInfo: info('kw_2') })));
        requests.answers.set('status', state({ musicId: 'kw_3', musicInfo: info('kw_3'), listId: 'love' }));
        await player.getStatus(target!.song);
        expect(player.isPrepared!(target!.song)).toBe(false);
        requests.calls.length = 0;
        await player.play(target!.song, 0);
        expect(playOps()).toEqual([{ target: 'list', listId: 'love', musicId: 'kw_2' }]);
    });

    it('asks once, when linked, what LX Music already plays as the app opens', async () => {
        requests.answers.set('linkStatus', { linked: true });
        const told: string[] = [];
        createLxmusicExternalPlayback().watchPlayer!(status => told.push(status.mediaId));
        await vi.waitFor(() => { expect(told).toEqual(['kw_9']); });

        requests.calls.length = 0;
        requests.answers.set('linkStatus', { linked: false });
        createLxmusicExternalPlayback().watchPlayer!(status => told.push(status.mediaId));
        await vi.waitFor(() => { expect(requests.calls.map(call => call.operation)).toEqual(['linkStatus']); });
        expect(told).toEqual(['kw_9']);
    });

    it('sends the loop mode, quality, mute apart, next and play-later in LX Music terms', async () => {
        const player = createLxmusicExternalPlayback();
        await player.setLoopMode!('off');
        await player.setShuffle!(true);
        await player.setShuffle!(false);
        await player.qualityChoices!.set('master');
        await player.setQuality!('lossless');
        await player.getStatus(normalizeLxmusicSong(info('kw_9')));
        await player.setVolume!(0.4, true);
        await player.skip!('next');
        await player.queueInPlayer!([normalizeLxmusicSong(info('kw_5'))], 'next');
        await player.queueInPlayer!([normalizeLxmusicSong(info('kw_6')), normalizeLxmusicSong(info('kw_7'))], 'end');
        expect(playOps()).toEqual([
            { action: 'playMode', value: 'list' },
            { action: 'playMode', value: 'random' },
            { action: 'playMode', value: 'listLoop' },
            { action: 'quality', value: 'master' },
            { action: 'quality', value: 'flac' },
            { action: 'volume', value: 0.4 },
            { action: 'mute', value: true },
            { action: 'next' },
            { target: 'later', musicInfos: [info('kw_5')], top: true },
            { target: 'later', musicInfos: [info('kw_6'), info('kw_7')], top: false },
        ]);
    });
});
