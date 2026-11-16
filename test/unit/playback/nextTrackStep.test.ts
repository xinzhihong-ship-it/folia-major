import { describe, expect, it } from 'vitest';
import { isListenerNextStep } from '@/components/app/playback/start/nextTrackStep';
import type { SongResult } from '@/types';

// test/unit/playback/nextTrackStep.test.ts
// The listener's own step to the next track is asked of a player that leads playback; the app's own
// steps (an end, a failure skipped, an automix hand-over, a queue from a given song) are not.

describe('isListenerNextStep', () => {
    it('is the listener step with no options or only navigation', () => {
        expect(isListenerNextStep()).toBe(true);
        expect(isListenerNextStep({ shouldNavigateToPlayer: false })).toBe(true);
    });

    it('is not for the steps the app takes by itself', () => {
        expect(isListenerNextStep({ playedToEnd: true })).toBe(false);
        expect(isListenerNextStep({ allowStopOnMissing: true })).toBe(false);
        expect(isListenerNextStep({ isAutomixAdvance: true })).toBe(false);
        expect(isListenerNextStep({ unavailableSkipCount: 0 })).toBe(false);
        expect(isListenerNextStep({ fromSong: { id: 1 } as SongResult })).toBe(false);
    });
});
