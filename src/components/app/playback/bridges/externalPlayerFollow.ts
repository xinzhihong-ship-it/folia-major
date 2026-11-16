import type { OnlineProviderId } from '../../../../types/onlineMusic';

// src/components/app/playback/bridges/externalPlayerFollow.ts
// When the app takes up a track a leading external player started by itself in its own window
// (useExternalPlaybackBridge): as the plan for such players has it, the app shows that track and gives
// way to it, its own song included, unless the listener turned following off, the stage holds the
// screen, or the route is already on that player (its polling follows it there).

export type TakeUpFacts = {
    /** The listener's setting (`followExternalPlayer`). */
    followEnabled: boolean;
    /** The player says it is playing a track (it names one). */
    playerPlaying: boolean;
    /** The provider of the player. */
    playerProviderId: OnlineProviderId;
    /** The app is on the external route, and the provider of the song it plays there. */
    onExternalRoute: boolean;
    routeProviderId: OnlineProviderId | null;
    /** The stage shows another source's lyrics. */
    stageActive: boolean;
};

/** Whether the app takes up the track the player started. */
export const shouldTakeUpExternalPlayer = (facts: TakeUpFacts): boolean => {
    if (!facts.followEnabled || !facts.playerPlaying || facts.stageActive) return false;
    return !(facts.onExternalRoute && facts.routeProviderId === facts.playerProviderId);
};

/**
 * The follows in flight, one per track: a second word of the same track (the route tells again after
 * a while, the player's own event says it too) waits for the first instead of reading it again.
 */
export const createFollowsInFlight = () => {
    const inFlight = new Set<string>();
    return {
        begin(key: string): boolean {
            if (inFlight.has(key)) return false;
            inFlight.add(key);
            return true;
        },
        end(key: string): void {
            inFlight.delete(key);
        },
    };
};
