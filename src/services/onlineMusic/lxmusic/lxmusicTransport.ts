import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderErrorCode } from '../../../types/onlineMusic';

// src/services/onlineMusic/lxmusic/lxmusicTransport.ts
// 洛雪音乐的请求边界：渲染进程只经主进程的桥（electron/lxmusic/lxmusicApiBridge.cjs）找洛雪的本机接口
// （洛雪「设置 → 开放 API → Folia 对接」），连接令牌留在主进程。洛雪推来的事件（状态变了、列表变了、连上断开）
// 也经这里收。

export type LxmusicBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string; cause?: string } };

export type LxmusicEvent =
    | { type: 'state'; data: unknown }
    | { type: 'lists'; data: unknown }
    | { type: 'connection'; data: { connected: boolean } };

/** 网页版没有桌面端的桥。 */
export const LXMUSIC_NEEDS_DESKTOP = 'LX Music requires the desktop app';

export const getLxmusicTransportAvailability = () => (
    typeof window !== 'undefined' && typeof window.electron?.lxmusicRequest === 'function'
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

const PROVIDER_ERROR_CODES: readonly ProviderErrorCode[] = [
    'auth-required', 'unsupported', 'not-public', 'unavailable', 'not-playable', 'preview-only',
    'subscription-required', 'region-restricted', 'network', 'invalid-response',
];

// 桥回的错误码已经是共用的码；`cause` 是洛雪自己的码（not-running、not-playable、unknown-source…），lxmusicFailure.ts 按它分情况。
export async function requestLxmusic<T = unknown>(operation: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!getLxmusicTransportAvailability().configured) {
        throw new OnlineProviderError('unavailable', LXMUSIC_NEEDS_DESKTOP, 'lxmusic', 'runtime-unavailable');
    }
    const request = window.electron?.lxmusicRequest;
    if (!request) throw new OnlineProviderError('unavailable', LXMUSIC_NEEDS_DESKTOP, 'lxmusic', 'runtime-unavailable');
    let result: LxmusicBridgeResult;
    try {
        result = await request(operation, params);
    } catch (error) {
        throw new OnlineProviderError('network', 'LX Music desktop request failed', 'lxmusic', error);
    }
    if (!result.ok) {
        const code = (PROVIDER_ERROR_CODES as readonly string[]).includes(result.error.code) ? result.error.code as ProviderErrorCode : 'invalid-response';
        throw new OnlineProviderError(code, result.error.message, 'lxmusic', result.error.cause);
    }
    return result.data as T;
}

/** 收洛雪推来的事件；网页版什么都收不到。回取消订阅的函数。 */
export const subscribeLxmusicEvents = (listener: (event: LxmusicEvent) => void): (() => void) => (
    typeof window !== 'undefined' && typeof window.electron?.onLxmusicEvent === 'function'
        ? window.electron.onLxmusicEvent(listener)
        : () => {}
);
