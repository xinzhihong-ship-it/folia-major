import { describe, expect, it } from 'vitest';
import { createFollowsInFlight, shouldTakeUpExternalPlayer, type TakeUpFacts } from '@/components/app/playback/bridges/externalPlayerFollow';

// test/unit/playback/externalPlayerFollow.test.ts
// 外部播放器（自己管队列的那种）在它自己的窗口里开播时，应用接过来、自己的歌让出来；关了跟随、舞台占着、
// 或者路线已经在这个播放器上时不接。同一首的跟随同时只做一次。

const facts = (overrides: Partial<TakeUpFacts> = {}): TakeUpFacts => ({
    followEnabled: true,
    playerPlaying: true,
    playerProviderId: 'lxmusic',
    onExternalRoute: false,
    routeProviderId: null,
    stageActive: false,
    ...overrides,
});

describe('taking up a track the external player started', () => {
    it('takes it up, giving way with the app own song or another provider route', () => {
        expect(shouldTakeUpExternalPlayer(facts())).toBe(true);
        expect(shouldTakeUpExternalPlayer(facts({ onExternalRoute: true, routeProviderId: 'appleMusic' }))).toBe(true);
    });

    it('leaves it where following is off, the player is not playing, or the stage holds the screen', () => {
        expect(shouldTakeUpExternalPlayer(facts({ followEnabled: false }))).toBe(false);
        expect(shouldTakeUpExternalPlayer(facts({ playerPlaying: false }))).toBe(false);
        expect(shouldTakeUpExternalPlayer(facts({ stageActive: true }))).toBe(false);
    });

    it('leaves it to the route where the route already plays in that player', () => {
        expect(shouldTakeUpExternalPlayer(facts({ onExternalRoute: true, routeProviderId: 'lxmusic' }))).toBe(false);
    });
});

describe('follows in flight', () => {
    it('lets one follow of a track run at a time', () => {
        const follows = createFollowsInFlight();
        expect(follows.begin('lxmusic:kw_1')).toBe(true);
        expect(follows.begin('lxmusic:kw_1')).toBe(false);
        expect(follows.begin('lxmusic:kw_2')).toBe(true);
        follows.end('lxmusic:kw_1');
        expect(follows.begin('lxmusic:kw_1')).toBe(true);
    });
});
