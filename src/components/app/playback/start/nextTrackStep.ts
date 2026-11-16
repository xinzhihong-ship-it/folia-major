import type { NextTrackOptions } from '../../../../types/appPlayback';

// src/components/app/playback/start/nextTrackStep.ts
// Which steps to the next track are the listener's own (the next button, a shortcut, a command, a
// media key) and which the app takes by itself (a track played to its end, a failure skipped, an
// automix hand-over, a queue reached from a given song). A player that leads playback is asked for
// the listener's steps (usePlaybackQueueController.handleNextTrack); the app's own steps still pick
// from the queue, which mirrors the player's.

/** Whether this step to the next track is the listener's own. */
export const isListenerNextStep = (options?: NextTrackOptions): boolean => !(
    options?.allowStopOnMissing
    || options?.playedToEnd
    || options?.fromSong
    || options?.isAutomixAdvance
    || options?.unavailableSkipCount !== undefined
);
