import { useEffect, useState } from 'react';
import { omni } from '../../../services/onlineMusic/omni';
import { useSearchNavigationStore, type SearchKind, type SearchSource } from '../../../stores/useSearchNavigationStore';
import type { ProviderSearchScope } from '../../../types/onlineMusic';

// src/components/app/search/useSearchScopes.ts
// 搜索页的范围小标签：在线平台声明了 search.getScopes（一次搜好几家的平台）时，单曲搜索能收窄到其中一家。
// 换来源时读一次；没读到（平台的本机服务还没开）时每搜一次再试。记着的范围带着名字，读不到列表时也显示它，
// 搜索按它收窄、界面也看得到、能换回全部；读到的列表里没有它了（那一家没了）就回到全部。

type LoadedScopes = { source: SearchSource; scopes: ProviderSearchScope[]; ok: boolean };

/** 这个来源单曲搜索能收窄到的几部分，和选着的那一部分（null 是全部）。没有范围的来源、专辑和歌单搜索回空列表。 */
export const useSearchScopes = (source: SearchSource, kind: SearchKind) => {
    const [loaded, setLoaded] = useState<LoadedScopes | null>(null);
    const stored = useSearchNavigationStore(state => state.searchScopes[source] ?? null);
    const submittedQuery = useSearchNavigationStore(state => state.submittedQuery);
    // 读到过就不再读；没读到时，每搜一次（提交的词变了）再试一次
    const retryKey = loaded?.source === source && loaded.ok ? 'loaded' : submittedQuery;

    useEffect(() => {
        if (source === 'local' || source === 'navidrome') return;
        let cancelled = false;
        omni.getProviderSearchScopes(source).then(scopes => {
            if (cancelled) return;
            setLoaded({ source, scopes, ok: true });
            const kept = useSearchNavigationStore.getState().searchScopes[source];
            if (kept && scopes.length > 0 && !scopes.some(item => item.id === kept.id)) {
                console.info('[SearchScopes] the kept search scope is gone: searching all of the source again', { source });
                useSearchNavigationStore.getState().setSearchScope(source, null);
            }
        }, (error: unknown) => {
            if (cancelled) return;
            setLoaded({ source, scopes: [], ok: false });
            console.warn('[SearchScopes] the search scopes could not be read', error);
        });
        return () => {
            cancelled = true;
        };
    }, [source, retryKey]);

    const listed = loaded?.source === source ? loaded.scopes : [];
    // 列表没读到、但记着一个范围：只列它，让人看得到、也能换回全部
    const offered = listed.length > 0 ? listed : stored ? [stored] : [];
    const scopes = kind === 'song' ? offered : [];
    const scope = stored && scopes.some(item => item.id === stored.id) ? stored.id : null;
    return { scopes, scope };
};
