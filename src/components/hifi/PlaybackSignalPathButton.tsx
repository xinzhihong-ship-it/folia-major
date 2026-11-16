import React from 'react';
import { Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QuickTile } from '../panelTab/controls/QuickTile';
import { openHifiSignalPath } from './hifiPanelStore';
import { playbackRouteSummary } from './playbackRouteSummary';
import { useExternalPlayerSignal } from './useExternalPlayerSignal';
import { useHifiSignalPath } from './useHifiSignalPath';
import { useWebAudioSignal } from './useWebAudioSignal';

// 音质页复用控制页的信号链路卡片样式；名字后面带上当前链路的一词概括，细节在打开的弹窗中展示。
// 外部播放路线上声音不经 Folia 的引擎：概括写播放器的名字和它说的音质（useExternalPlayerSignal）。

export const PlaybackSignalPathButton: React.FC = () => {
    const { t } = useTranslation();
    const summary = playbackRouteSummary(useHifiSignalPath(), useWebAudioSignal());
    const externalPlayer = useExternalPlayerSignal();
    const verdict = externalPlayer ?? (summary ? t(`hifi.route.${summary}`) : null);
    return (
        <div className="grid min-w-0 px-1 py-2">
            <QuickTile
                kind="open"
                lit={summary === 'nativePassthrough'}
                icon={<Route size={18} />}
                label={verdict
                    ? t('hifi.player.signalPathTile', { verdict })
                    : t('hifi.web.openSignalPath')}
                aria-haspopup="dialog"
                onClick={openHifiSignalPath}
            />
        </div>
    );
};
