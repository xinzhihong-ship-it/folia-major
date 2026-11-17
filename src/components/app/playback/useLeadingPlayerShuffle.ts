import { useSyncExternalStore } from 'react';
import { getLeadingPlayerShuffle, subscribeExternalPlayback } from '../../../services/onlineMusic/externalPlayback';

// src/components/app/playback/useLeadingPlayerShuffle.ts
// 正在主导播放的外部播放器自己的随机播放开着没有：随机按钮按它亮起。没有主导的播放器、或它没有随机播放时是 null。

const subscribe = (notify: () => void) => subscribeExternalPlayback(() => { notify(); });

export const useLeadingPlayerShuffle = (): boolean | null => useSyncExternalStore(subscribe, getLeadingPlayerShuffle, () => null);
