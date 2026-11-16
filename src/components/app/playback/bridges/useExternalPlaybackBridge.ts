import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { NextTrackOptions, PlaybackNavigationOptions } from '../../../../types/appPlayback';
import type { SongResult } from '../../../../types';
import type { OnlineProviderId, ProviderExternalPlaybackStatus } from '../../../../types/onlineMusic';
import { getExternalSong, installExternalPlayback, isExternalRoute, isLeadingFollowCurrent, subscribeExternalPlayback } from '../../../../services/onlineMusic/externalPlayback';
import { onlineFailureOf } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { omni } from '../../../../services/onlineMusic/omni';
import { noteWholeQueueWrite } from '../../../../services/wholeQueueWrites';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { replacePlayQueue, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { getOnlineProviderIdForSong, getPlaybackSongKey, samePlaybackKeySequence } from '../../../../utils/appPlaybackGuards';
import { onlineFailureToast } from '../source/onlineFailureToast';
import { persistPlaybackCache } from '../persistPlaybackCache';
import { createFollowsInFlight, shouldTakeUpExternalPlayer } from './externalPlayerFollow';

// src/components/app/playback/bridges/useExternalPlaybackBridge.ts
// The React side of the external playback route: mounts its guard and shim, moves the queue on
// when the provider's player reports the end of a track, and tells the listener what it could not
// do. Transport controls live with the other routes' (usePlaybackTransportController).
// A leading player (`leadsPlayback`) moves on by itself: the track it moves to is followed here
// through the ordinary play (playSong, whose start takes the player as it is), its queue is mirrored
// into the app's, and a track it starts in its own window is taken up too (externalPlayerFollow.ts).
// A follow reads the player first; when that read is back it is dropped if it went stale meanwhile
// (the listener played something else, or the player moved on again): the newest wins.

type PlaySong = (song: SongResult, queue?: SongResult[], isFmCall?: boolean, options?: PlaybackNavigationOptions) => Promise<void>;

type UseExternalPlaybackBridgeParams = {
    handleNextTrack: (options?: NextTrackOptions) => Promise<void> | void;
    playSong: PlaySong;
};

export function useExternalPlaybackBridge({ handleNextTrack, playSong }: UseExternalPlaybackBridgeParams) {
    // Read here rather than passed in: the callback and i18n are the newest at the moment of an event.
    const { t } = useTranslation();
    const latestRef = useRef({ handleNextTrack, playSong, t });
    useEffect(() => {
        latestRef.current = { handleNextTrack, playSong, t };
    });

    useEffect(() => {
        installExternalPlayback();

        const followsInFlight = createFollowsInFlight();
        // The track a leading player is on, shown as the app's own (through playSong, so the newest play
        // wins). `stillWanted` is asked once the player's read is back: a stale follow is dropped.
        const followPlayer = async (
            providerId: OnlineProviderId,
            status: ProviderExternalPlaybackStatus,
            stillWanted: (song: SongResult) => boolean,
        ) => {
            const key = `${providerId}:${status.mediaId}`;
            if (!followsInFlight.begin(key)) return;
            try {
                const target = await omni.followExternalPlayer(providerId, status);
                if (!target) {
                    console.info('[ExternalPlaybackBridge] the external player is on a track that cannot be followed', { providerId });
                    return;
                }
                if (!stillWanted(target.song)) {
                    console.info('[ExternalPlaybackBridge] a follow went stale while the player was read: dropped', { providerId });
                    return;
                }
                await latestRef.current.playSong(target.song, target.queue, false, {
                    shouldNavigateToPlayer: false,
                    startAtSec: Math.max(0, status.positionMs / 1000),
                });
            } catch (error) {
                console.warn('[ExternalPlaybackBridge] could not follow the external player', error);
            } finally {
                followsInFlight.end(key);
            }
        };

        // A leading player's queue changed (or the app started a song in it): the app's queue becomes it.
        const mirrorQueue = async (song: SongResult) => {
            let queue: SongResult[] | null;
            try {
                queue = await omni.getExternalPlayerQueue(song);
            } catch (error) {
                console.warn('[ExternalPlaybackBridge] could not read the external player queue', error);
                return;
            }
            const state = usePlaybackStore.getState();
            // Moved on meanwhile: the queue read belongs to a song no longer shown.
            if (!queue?.length || !isExternalRoute() || !state.currentSong || getPlaybackSongKey(state.currentSong) !== getPlaybackSongKey(song)) return;
            if (!state.isFmMode && samePlaybackKeySequence(state.playQueue, queue)) return;
            noteWholeQueueWrite();
            replacePlayQueue(queue, false);
            void persistPlaybackCache(state.currentSong, queue);
            console.info('[ExternalPlaybackBridge] mirrored the external player queue', { length: queue.length });
        };

        const unsubscribe = subscribeExternalPlayback(event => {
            if (event.type === 'ended') {
                // As <audio>'s ended handler does: nothing after this when the queue is over.
                void latestRef.current.handleNextTrack({ allowStopOnMissing: true, playedToEnd: true, shouldNavigateToPlayer: false });
                return;
            }
            if (event.type === 'player-moved') {
                const providerId = getOnlineProviderIdForSong(event.song);
                const from = event.song;
                if (providerId) void followPlayer(providerId, event.status, to => isLeadingFollowCurrent(from, to));
                return;
            }
            if (event.type === 'player-queue') {
                void mirrorQueue(event.song);
                return;
            }
            if (event.type === 'foreign-track') {
                setStatusMessage({ type: 'info', text: latestRef.current.t('status.externalPlayerMovedOn') });
                return;
            }
            if (event.type === 'failure') {
                const song = usePlaybackStore.getState().currentSong;
                const providerId = song?.sourceRef?.kind === 'online' ? song.sourceRef.providerId : undefined;
                setStatusMessage(onlineFailureToast(
                    onlineFailureOf({ operation: 'audio', providerId }, { error: event.error }),
                    latestRef.current.t,
                ));
            }
        });

        // A leading player started a track in its own window: the app takes it up and gives way to it,
        // its own song included (externalPlayerFollow.ts). The listener can turn this off
        // (`followExternalPlayer`); the route itself still follows the player it plays in.
        const latestWatched = new Map<OnlineProviderId, ProviderExternalPlaybackStatus>();
        const takeUpFacts = (providerId: OnlineProviderId, status: ProviderExternalPlaybackStatus) => {
            const onRoute = isExternalRoute();
            const routeSong = onRoute ? getExternalSong() : null;
            return {
                followEnabled: useAudioSettingsStore.getState().followExternalPlayer,
                playerPlaying: status.isPlaying && Boolean(status.mediaId),
                playerProviderId: providerId,
                onExternalRoute: onRoute,
                routeProviderId: routeSong ? getOnlineProviderIdForSong(routeSong) : null,
                stageActive: usePlaybackStore.getState().activePlaybackContext === 'stage',
            };
        };
        const stopWatching = omni.watchExternalPlayers((providerId, status) => {
            latestWatched.set(providerId, status);
            if (!shouldTakeUpExternalPlayer(takeUpFacts(providerId, status))) return;
            console.info('[ExternalPlaybackBridge] the external player started a track by itself: taking it up', { providerId });
            void followPlayer(providerId, status, song => {
                // Still the newest word of that player, and still a moment to take it up.
                const newest = latestWatched.get(providerId);
                return newest !== undefined && omni.isExternalPlaybackStatusForSong(song, newest)
                    && shouldTakeUpExternalPlayer(takeUpFacts(providerId, newest));
            });
        });

        return () => {
            unsubscribe();
            stopWatching();
        };
    }, []);
}
