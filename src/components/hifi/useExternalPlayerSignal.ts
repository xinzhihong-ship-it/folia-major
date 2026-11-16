import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { providerDisplayName } from '../../i18n/providerName';
import { getExternalQualityLabel, subscribeExternalPlayback } from '../../services/onlineMusic/externalPlayback';
import { omni } from '../../services/onlineMusic/omni';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { getOnlineProviderIdForSong } from '../../utils/appPlaybackGuards';

// src/components/hifi/useExternalPlayerSignal.ts
// 外部播放路线上的信号链路：声音由平台自己的播放器放，不经 Folia 的引擎；一词概括写成播放器的名字和它说的
// 音质（如「某平台 · FLAC」）。音质随播放器的回答更新（externalPlayback 的 status 事件）。

const subscribe = (notify: () => void) => subscribeExternalPlayback(() => { notify(); });

/** 外部播放路线上播放器的名字与音质；不在这条路线上回 null。 */
export const useExternalPlayerSignal = (): string | null => {
    const { t } = useTranslation();
    const onRoute = usePlaybackStore(state => state.playbackRoute === 'external');
    const song = usePlaybackStore(state => state.currentSong);
    const quality = useSyncExternalStore(subscribe, getExternalQualityLabel, () => null);
    if (!onRoute) return null;
    const providerId = song ? getOnlineProviderIdForSong(song) : null;
    const provider = providerId ? omni.getProviderSummaries().find(summary => summary.providerId === providerId) : undefined;
    const name = provider ? providerDisplayName(t, provider) : t('hifi.route.externalPlayer');
    return quality ? `${name} · ${quality}` : name;
};
