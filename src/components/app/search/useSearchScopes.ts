import { useEffect, useState } from 'react';
import { omni } from '../../../services/onlineMusic/omni';
import { useSearchNavigationStore, type SearchKind, type SearchSource } from '../../../stores/useSearchNavigationStore';
import type { ProviderSearchScope } from '../../../types/onlineMusic';

// src/components/app/search/useSearchScopes.ts
// 搜索页的范围小标签：在线平台声明了 search.getScopes（一次搜好几家的平台）时，单曲搜索能收窄到其中一家。
// 换来源时重读；记着的范围不在平台给的列表里了（那一家没了）就回到全部。

type LoadedScopes = { source: SearchSource; scopes: ProviderSearchScope[] };

/** 这个来源单曲搜索能收窄到的几部分，和选着的那一部分（null 是全部）。没有范围的来源、专辑和歌单搜索回空列表。 */
export const useSearchScopes = (source: SearchSource, kind: SearchKind) => {
    const [loaded, setLoaded] = useState<LoadedScopes | null>(null);
    const stored = useSearchNavigationStore(state => state.searchScopes[source] ?? null);

    useEffect(() => {
        if (source === 'local' || source === 'navidrome') return;
        let cancelled = false;
        omni.getProviderSearchScopes(source).then(scopes => {
            if (cancelled) return;
            setLoaded({ source, scopes });
            const kept = useSearchNavigationStore.getState().searchScopes[source];
            if (kept && scopes.length > 0 && !scopes.some(item => item.id === kept)) {
                console.info('[SearchScopes] the kept search scope is gone: searching all of the source again', { source });
                useSearchNavigationStore.getState().setSearchScope(source, null);
            }
        }, (error: unknown) => {
            console.warn('[SearchScopes] the search scopes could not be read', error);
        });
        return () => {
            cancelled = true;
        };
    }, [source]);

    const scopes = kind === 'song' && loaded?.source === source ? loaded.scopes : [];
    const scope = stored && scopes.some(item => item.id === stored) ? stored : null;
    return { scopes, scope };
};
