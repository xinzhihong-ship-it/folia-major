import { requestLxmusic } from './lxmusicTransport';
import type { LxMusicInfo } from './lxmusicNormalize';

// src/services/onlineMusic/lxmusic/lxmusicCover.ts
// 歌曲列表里不带封面的歌（很多平台的封面要另外问），播放时问洛雪要一张。洛雪回在线地址，或者本地歌曲
// 内嵌封面的字节（base64）；字节做成 data URL。同一首歌只问一次。

const MAX_KEPT = 200;
const kept = new Map<string, string | null>();

/** 洛雪的回答（`{ coverUrl }` 或 `{ cover: { mimeType, data } }`，没有时 null）换成能显示的地址。 */
export const lxCoverUrlOf = (answer: unknown): string | null => {
    if (typeof answer !== 'object' || answer === null) return null;
    const { coverUrl, cover } = answer as { coverUrl?: unknown; cover?: { mimeType?: unknown; data?: unknown } | null };
    if (typeof coverUrl === 'string' && /^https?:\/\//i.test(coverUrl)) return coverUrl;
    if (cover && typeof cover.mimeType === 'string' && /^image\//.test(cover.mimeType) && typeof cover.data === 'string') {
        return `data:${cover.mimeType};base64,${cover.data}`;
    }
    return null;
};

export async function readLxCoverUrl(musicInfo: LxMusicInfo): Promise<string | null> {
    if (kept.has(musicInfo.id)) return kept.get(musicInfo.id) ?? null;
    const url = lxCoverUrlOf(await requestLxmusic('pic', { musicInfo }));
    if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value as string);
    kept.set(musicInfo.id, url);
    return url;
}
