import type { OnlineFailureDetail, OnlineFailureOperation } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/lxmusic/lxmusicFailure.ts
// 洛雪的请求没成功时是哪一种情况。桥（electron/lxmusic/lxmusicApiBridge.cjs）把洛雪自己的码放在错误的 `cause` 里：
//   not-running   洛雪没开，或没开「Folia 对接」（连接文件不在、连不上）
//   unauthorized  令牌对不上（洛雪重开后还没重读连接文件）
//   unavailable   洛雪的主窗口还没准备好，或者刚关掉了「Folia 对接」
//   not-playable  洛雪没有这个平台的音源（自定义源没配这个平台）
//   runtime-unavailable  网页版没有桌面端的桥

const LOCAL_SERVICE_CAUSES = new Set(['not-running', 'unauthorized', 'unavailable']);

export function describeLxmusicFailure(_operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null {
    if (!(error instanceof OnlineProviderError)) return null;
    const cause = typeof error.cause === 'string' ? error.cause : '';
    if (cause === 'runtime-unavailable') return { case: 'not-configured' };
    if (LOCAL_SERVICE_CAUSES.has(cause)) return { case: 'local-service-stopped', code: cause };
    if (error.code === 'not-playable') return { case: 'no-audio', message: error.message };
    return null;
}
