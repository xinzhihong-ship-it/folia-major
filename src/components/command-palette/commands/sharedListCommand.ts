import { ListMusic } from 'lucide-react';
import { omni } from '../../../services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { usePlayingSongLocatorStore } from '../../../stores/usePlayingSongLocatorStore';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import type { OnlineProviderId } from '../../../types/onlineMusic';
import { createSearchResultCollection } from '../../app/search/searchCollectionAdapters';
import { defineCommand } from '../commandFactories';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/sharedListCommand.ts
// 「打开分享的歌单」：粘贴一张歌单的分享链接（或「平台 ID」），由能打开分享集合的平台
// （catalog.openSharedCollection）打开，进入它的歌单页，可以播放全部、收藏。只有连着这样的平台时出现；
// 当前平台能打开就用当前平台。

const LINK = /https?:\/\/\S+/i;

/** 能打开分享集合、而且连着的平台：当前平台优先。 */
const providerForSharedLists = (): OnlineProviderId | null => {
    const candidates = omni.getProviderSummaries()
        .filter(summary => summary.status === 'authenticated' && omni.canOpenSharedCollections(summary.providerId))
        .map(summary => summary.providerId);
    const active = useOnlineProviderAccountStore.getState().activeProviderId;
    return candidates.includes(active) ? active : candidates[0] ?? null;
};

/**
 * 输入里的平台和链接或 ID：有链接时平台由提供方按链接认；没有链接时第一个词须是平台的 id 或名字
 * （「wy 123456」），否则回 null。
 */
export const parseSharedListInput = (input: string, sources: Array<{ id: string; name: string }>): { text: string; source?: string } | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (LINK.test(trimmed)) return { text: trimmed };
    const match = /^(\S+)\s+(\S.*)$/.exec(trimmed);
    if (!match) return null;
    const word = match[1].toLowerCase();
    const source = sources.find(item => item.id.toLowerCase() === word || item.name.toLowerCase() === word);
    return source ? { text: match[2].trim(), source: source.id } : null;
};

export const sharedListCommand: CommandPaletteCommand = defineCommand({
    id: 'open-shared-list',
    group: 'navigation',
    title: 'Open a shared song list',
    description: 'Open a song list by its share link or ID',
    keywords: ['shared playlist', 'playlist link', 'open playlist', 'import playlist', '分享歌单', '打开歌单', '歌单链接', '导入歌单'],
    icon: ListMusic,
    requiresInput: true,
    isAvailable: () => providerForSharedLists() !== null,
    placeholder: context => context.shared.t('sharedList.inputPlaceholder'),
    execute: async (input, context) => {
        const providerId = providerForSharedLists();
        if (!providerId) {
            setStatusMessage({ type: 'error', text: context.shared.t('sharedList.unavailable') });
            return false;
        }
        let sources: Array<{ id: string; name: string }> = [];
        if (!LINK.test(input)) {
            try {
                sources = await omni.getSharedCollectionSources(providerId);
            } catch (error) {
                console.warn('[SharedListCommand] could not read the platforms a shared list may come from', error);
            }
        }
        const parsed = parseSharedListInput(input, sources);
        if (!parsed) {
            setStatusMessage({ type: 'info', text: context.shared.t('sharedList.needSource') });
            return false;
        }
        setStatusMessage({ type: 'info', text: context.shared.t('sharedList.opening'), durationMs: 1500 });
        try {
            const collection = await omni.openSharedCollection(providerId, parsed.text, parsed.source);
            const navigator = usePlayingSongLocatorStore.getState().navigator;
            if (!navigator) return false;
            navigator.navigateToCollection(createSearchResultCollection(collection), 'home');
            console.info('[SharedListCommand] opened a shared song list', { providerId, withSource: Boolean(parsed.source) });
            return true;
        } catch (error) {
            console.warn('[SharedListCommand] the shared song list could not be opened', error);
            const reason = error instanceof Error ? error.message : String(error);
            setStatusMessage({ type: 'error', text: context.shared.t('sharedList.openFailed').replace('{{reason}}', reason) });
            return false;
        }
    },
});
