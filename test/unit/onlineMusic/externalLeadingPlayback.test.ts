import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ProviderExternalPlaybackStatus } from '@/types/onlineMusic';

// test/unit/onlineMusic/externalLeadingPlayback.test.ts
// The external route with a leading player (`leadsPlayback`): a player that keeps its own queue,
// play mode and volume. Its moves to another track are followed, not paused; its end does not move
// the app's queue; its volume and play mode become the app's; the listener's next is asked of it.

const omniMock = vi.hoisted(() => ({
    canPlayExternally: vi.fn(() => true),
    canPlaySong: vi.fn(() => true),
    leadsExternalPlayback: vi.fn<(song: unknown) => boolean>(() => true),
    prepareExternalPlaybackQueue: vi.fn(async () => {}),
    playSongExternally: vi.fn<(song: unknown, startSec: number, context?: unknown) => Promise<void>>(async () => {}),
    pauseExternalPlayback: vi.fn<(song: unknown) => Promise<void>>(async () => {}),
    resumeExternalPlayback: vi.fn<(song: unknown) => Promise<void>>(async () => {}),
    seekExternalPlayback: vi.fn<(song: unknown, seconds: number) => Promise<void>>(async () => {}),
    setExternalPlaybackVolume: vi.fn<(song: unknown, volume: number, muted?: boolean) => Promise<void>>(async () => {}),
    setExternalPlaybackRepeatOne: vi.fn<(song: unknown, enabled: boolean) => Promise<void>>(async () => {}),
    setExternalPlaybackLoopMode: vi.fn<(song: unknown, mode: 'off' | 'all' | 'one') => Promise<void>>(async () => {}),
    setExternalPlaybackQuality: vi.fn<(song: unknown, quality: string) => Promise<void>>(async () => {}),
    setExternalPlaybackShuffle: vi.fn<(song: unknown, on: boolean) => Promise<void>>(async () => {}),
    hasExternalPlayerQualityChoices: vi.fn<(song: unknown) => boolean>(() => false),
    skipExternalPlayback: vi.fn<(song: unknown, direction: 'next' | 'prev') => Promise<void>>(async () => {}),
    getExternalPlaybackStatus: vi.fn<(song: unknown) => Promise<ProviderExternalPlaybackStatus>>(async () => ({
        mediaId: 'kw_1', isPlaying: true, positionMs: 10000, durationMs: 200000, ended: false,
    })),
    isExternalPlaybackStatusForSong: vi.fn((song: SongResult, status: ProviderExternalPlaybackStatus) => song.sourceRef?.kind === 'online' && status.mediaId === song.sourceRef.mediaId),
    resolveAudioQualityForSong: vi.fn<(song: unknown, quality: string) => string>((...args) => args[1]),
    adoptExternalPlayback: vi.fn<(song: unknown) => void>(() => {}),
}));

vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const engine = await import('@/services/onlineMusic/externalPlayback');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { PlayerState } = await import('@/types');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');

const song: SongResult = {
    id: 'kw_1',
    name: 'Example',
    artists: [{ id: 'A', name: 'A' }],
    album: { id: '', name: '' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'lxmusic', mediaId: 'kw_1' },
};

const status = (overrides: Partial<ProviderExternalPlaybackStatus> = {}): ProviderExternalPlaybackStatus => ({
    mediaId: 'kw_1', isPlaying: true, positionMs: 10000, durationMs: 200000, ended: false,
    volume: 0.6, muted: false, loopMode: 'all', queueRevision: '1', ...overrides,
});

const flush = () => vi.advanceTimersByTimeAsync(0);

const start = async () => {
    await engine.beginExternalPlayback(song, 0, { queue: [song] });
    engine.announceExternalPlayback();
    await flush();
};

describe('external route with a leading player', () => {
    const events: Array<{ type: string }> = [];
    let unsubscribe: () => void = () => {};

    beforeEach(() => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0, currentSong: null, isFmMode: false });
        useAudioSettingsStore.setState({ volume: 1, isMuted: false, loopMode: 'off', audioQuality: 'high' });
        for (const mock of Object.values(omniMock)) mock.mockClear();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status());
        events.length = 0;
        unsubscribe = engine.subscribeExternalPlayback(event => { events.push(event); });
    });

    afterEach(() => {
        unsubscribe();
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE });
        vi.useRealTimers();
    });

    it('hands the queue to the player and sets neither its volume nor its repeat', async () => {
        await start();
        expect(omniMock.playSongExternally).toHaveBeenCalledWith(song, 0, { queue: [song] });
        expect(omniMock.setExternalPlaybackVolume).not.toHaveBeenCalled();
        expect(omniMock.setExternalPlaybackRepeatOne).not.toHaveBeenCalled();
        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();
    });

    it('takes the player volume, mute and play mode into the settings without sending them back', async () => {
        await start();
        // Past the hold of the settings written in beforeEach (a change of the listener's)
        await vi.advanceTimersByTimeAsync(2500);
        const settings = useAudioSettingsStore.getState();
        expect(settings.volume).toBeCloseTo(0.6);
        expect(settings.loopMode).toBe('all');
        expect(omniMock.setExternalPlaybackVolume).not.toHaveBeenCalled();
        expect(omniMock.setExternalPlaybackLoopMode).not.toHaveBeenCalled();
    });

    it('sends the listener volume, mute apart, and loop mode to the player', async () => {
        await start();
        await vi.advanceTimersByTimeAsync(600);
        useAudioSettingsStore.getState().handleSetVolume(0.3);
        await flush();
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenLastCalledWith(song, 0.3, false);
        useAudioSettingsStore.getState().handleSetLoopMode('one');
        await flush();
        expect(omniMock.setExternalPlaybackLoopMode).toHaveBeenLastCalledWith(song, 'one');
        // An answer from before the change does not take the volume back
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ volume: 0.6, loopMode: 'all' }));
        await vi.advanceTimersByTimeAsync(600);
        expect(useAudioSettingsStore.getState().volume).toBeCloseTo(0.3);
        expect(useAudioSettingsStore.getState().loopMode).toBe('one');
    });

    it('follows another track the player moved to, once, and leaves it sounding', async () => {
        await start();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: 'kw_2', positionMs: 0 }));
        await vi.advanceTimersByTimeAsync(600);
        await vi.advanceTimersByTimeAsync(600);
        const moved = events.filter(event => event.type === 'player-moved');
        expect(moved).toHaveLength(1);
        expect(events.some(event => event.type === 'foreign-track')).toBe(false);
        expect(omniMock.pauseExternalPlayback).not.toHaveBeenCalled();
    });

    it('is told again to follow when the follow did not take, and knows a follow gone stale', async () => {
        await start();
        const moved = { ...song, id: 'kw_2', sourceRef: { kind: 'online' as const, providerId: 'lxmusic', mediaId: 'kw_2' } };
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: 'kw_2', positionMs: 0 }));
        await vi.advanceTimersByTimeAsync(600);
        expect(events.filter(event => event.type === 'player-moved')).toHaveLength(1);
        expect(engine.isLeadingFollowCurrent(song, moved)).toBe(true);
        // Still on it five seconds on: the follow did not take
        await vi.advanceTimersByTimeAsync(5600);
        expect(events.filter(event => event.type === 'player-moved')).toHaveLength(2);
        // The player moved on again: following kw_2 now would take the app back
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: 'kw_3', positionMs: 0 }));
        await vi.advanceTimersByTimeAsync(600);
        expect(engine.isLeadingFollowCurrent(song, moved)).toBe(false);
    });

    it('sends a volume moved while muted, with the mute', async () => {
        await start();
        await vi.advanceTimersByTimeAsync(2500);
        useAudioSettingsStore.getState().handleSetMuted(true);
        await flush();
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenLastCalledWith(song, 0.6, true);
        useAudioSettingsStore.getState().handleSetVolume(0.4);
        await flush();
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenLastCalledWith(song, 0.4, true);
    });

    it('shows the player quality setting without writing the preference every provider shares', async () => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ quality: 'standard' }));
        await start();
        await vi.advanceTimersByTimeAsync(2500);
        expect(engine.getLeadingPlayerQuality('lxmusic')).toBe('standard');
        expect(engine.getLeadingPlayerQuality('netease')).toBeNull();
        expect(useAudioSettingsStore.getState().audioQuality).toBe('high');
        expect(omniMock.setExternalPlaybackQuality).not.toHaveBeenCalled();
    });

    it('asks the player once for a quality the listener picks while it plays', async () => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ quality: 'standard' }));
        await start();
        await vi.advanceTimersByTimeAsync(600);
        engine.setLeadingPlayerQuality('lossless');
        useAudioSettingsStore.getState().setAudioQuality('lossless');
        await flush();
        expect(omniMock.setExternalPlaybackQuality).toHaveBeenCalledTimes(1);
        expect(omniMock.setExternalPlaybackQuality).toHaveBeenCalledWith(song, 'lossless');
        // The player's own setting already: nothing is sent
        engine.setLeadingPlayerQuality('standard');
        await flush();
        expect(omniMock.setExternalPlaybackQuality).toHaveBeenCalledTimes(1);
    });

    it('turns the player shuffle play mode the other way, standing over an answer that has not heard of it yet', async () => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ shuffle: false }));
        await start();
        await vi.advanceTimersByTimeAsync(2500);
        expect(engine.getLeadingPlayerShuffle()).toBe(false);
        expect(engine.toggleLeadingPlayerShuffle()).toBe(true);
        expect(engine.getLeadingPlayerShuffle()).toBe(true);
        expect(omniMock.setExternalPlaybackShuffle).toHaveBeenCalledWith(song, true);
        // The player still says off for a moment: the listener's press stands
        await vi.advanceTimersByTimeAsync(600);
        expect(engine.getLeadingPlayerShuffle()).toBe(true);
        // Later it is the player's word
        await vi.advanceTimersByTimeAsync(2500);
        expect(engine.getLeadingPlayerShuffle()).toBe(false);
    });

    it('keeps the player shuffle play mode across a track change, before the player answers for the new track', async () => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ shuffle: true }));
        await start();
        // Past the hold a press in an earlier test leaves behind (each test's fake clock starts over)
        await vi.advanceTimersByTimeAsync(6000);
        expect(engine.getLeadingPlayerShuffle()).toBe(true);
        const next: SongResult = { ...song, id: 'kw_2', sourceRef: { kind: 'online', providerId: 'lxmusic', mediaId: 'kw_2' } };
        await engine.beginExternalPlayback(next, 0, { queue: [song, next] });
        expect(engine.getLeadingPlayerShuffle()).toBe(true);
    });

    it('leaves the shuffle button to the app for a player without a shuffle play mode', async () => {
        await start();
        await vi.advanceTimersByTimeAsync(2500);
        expect(engine.getLeadingPlayerShuffle()).toBeNull();
        expect(engine.toggleLeadingPlayerShuffle()).toBe(false);
        expect(omniMock.setExternalPlaybackShuffle).not.toHaveBeenCalled();
    });

    it('leaves the setting of a player with quality levels of its own when the preference changes for another provider', async () => {
        omniMock.hasExternalPlayerQualityChoices.mockReturnValue(true);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ quality: 'lossless' }));
        await start();
        await vi.advanceTimersByTimeAsync(600);
        useAudioSettingsStore.getState().setAudioQuality('hires');
        await flush();
        expect(omniMock.setExternalPlaybackQuality).not.toHaveBeenCalled();
        omniMock.hasExternalPlayerQualityChoices.mockReturnValue(false);
    });

    it('does not move the app queue at the end of a track', async () => {
        await start();
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ isPlaying: false, positionMs: 200000 }));
        await vi.advanceTimersByTimeAsync(600);
        expect(events.some(event => event.type === 'ended')).toBe(false);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
        expect(omniMock.playSongExternally).toHaveBeenCalledTimes(1);
    });

    it('announces a new queue revision once', async () => {
        await start();
        await vi.advanceTimersByTimeAsync(1200);
        expect(events.filter(event => event.type === 'player-queue')).toHaveLength(1);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ queueRevision: '2' }));
        await vi.advanceTimersByTimeAsync(600);
        expect(events.filter(event => event.type === 'player-queue')).toHaveLength(2);
    });

    it('asks the player for the next track instead of stepping the app queue', async () => {
        expect(engine.stepLeadingExternalPlayer('next')).toBe(false);
        await start();
        expect(engine.isLeadingExternalRoute()).toBe(true);
        expect(engine.stepLeadingExternalPlayer('next')).toBe(true);
        await flush();
        expect(omniMock.skipExternalPlayback).toHaveBeenCalledWith(song, 'next');
    });

    it('sends a quality the listener picks to the player', async () => {
        await start();
        useAudioSettingsStore.getState().setAudioQuality('lossless');
        await flush();
        expect(omniMock.setExternalPlaybackQuality).toHaveBeenCalledWith(song, 'lossless');
    });

    it('runs the clock at the player speed', async () => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ rate: 2, positionMs: 10000 }));
        await start();
        const before = engine.getExternalPosition();
        // Before the next answer: the clock alone moves the position, twice as fast
        vi.advanceTimersByTime(300);
        expect(engine.getExternalPosition() - before).toBeCloseTo(0.6, 1);
    });
});
