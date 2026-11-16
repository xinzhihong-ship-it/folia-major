import React from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { SearchKind, SearchSource } from '../../../stores/useSearchNavigationStore';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { omni } from '../../../services/onlineMusic/omni';
import type { ProviderSearchScope } from '../../../types/onlineMusic';

// src/components/app/search/SearchTabs.tsx
// 搜索页的两排页签：来源（下面一道色条滑过去）与种类（大字，前面一个实心方块滑过去）。只有一种可搜时不画种类那排。
// 来源能把单曲搜索收窄到其中一部分时（useSearchScopes），种类下面再加一排范围小标签，第一个是「全部」。

const KIND_LABEL_KEYS: Record<SearchKind, string> = {
    song: 'search.kindSong',
    album: 'search.kindAlbum',
    playlist: 'search.kindPlaylist',
};

const MARK_SPRING = { type: 'spring', stiffness: 420, damping: 34 } as const;

export const useSearchSourceLabel = () => {
    const { t } = useTranslation();
    return (source: SearchSource) => {
        if (source === 'local') return t('search.sourceLocal');
        if (source === 'navidrome') return t('search.sourceNavidrome');
        return omni.getProviderLabel(source);
    };
};

type SearchTabsProps = {
    sources: SearchSource[];
    source: SearchSource;
    kinds: SearchKind[];
    kind: SearchKind;
    onSelectSource: (source: SearchSource) => void;
    onSelectKind: (kind: SearchKind) => void;
    /** 单曲搜索能收窄到的几部分；空的不画那一排。 */
    scopes?: ProviderSearchScope[];
    /** 选着的那一部分，null 是全部。 */
    scope?: string | null;
    onSelectScope?: (scope: string | null) => void;
};

const SearchTabs: React.FC<SearchTabsProps> = ({ sources, source, kinds, kind, onSelectSource, onSelectKind, scopes = [], scope = null, onSelectScope }) => {
    const { t } = useTranslation();
    const getSourceLabel = useSearchSourceLabel();
    const calm = useReducedMotionFor('uiMicroMotion');
    const transition = calm ? { duration: 0 } : MARK_SPRING;

    return (
        <>
            <nav className="search-sources" aria-label={t('search.sources')}>
                {sources.map(item => (
                    <button
                        type="button"
                        key={item}
                        onClick={() => {
                            if (item !== source) onSelectSource(item);
                        }}
                        className={`search-source ${item === source ? 'is-active' : ''}`}
                        aria-current={item === source ? 'true' : undefined}
                    >
                        {getSourceLabel(item)}
                        {item === source && (
                            <motion.span layoutId="search-source-mark" className="search-source-mark" transition={transition} />
                        )}
                    </button>
                ))}
            </nav>

            {kinds.length > 1 && (
                <div className="search-kinds" role="tablist" aria-label={t('search.kinds')}>
                    {kinds.map((item, index) => (
                        <button
                            type="button"
                            role="tab"
                            key={item}
                            aria-selected={item === kind}
                            onClick={() => {
                                if (item !== kind) onSelectKind(item);
                            }}
                            className={`search-kind ${item === kind ? 'is-active' : ''}`}
                        >
                            {item === kind && (
                                <motion.span layoutId="search-kind-mark" className="search-kind-mark" transition={transition} />
                            )}
                            <span className="search-kind-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                            <span className="search-kind-label">{t(KIND_LABEL_KEYS[item])}</span>
                        </button>
                    ))}
                </div>
            )}

            {scopes.length > 0 && onSelectScope && (
                <div className="search-scopes" role="radiogroup" aria-label={t('search.scopes')}>
                    {[{ id: null, name: t('search.scopeAll') }, ...scopes].map(item => (
                        <button
                            type="button"
                            role="radio"
                            key={item.id ?? ''}
                            aria-checked={item.id === scope}
                            onClick={() => {
                                if (item.id !== scope) onSelectScope(item.id);
                            }}
                            className={`search-scope ${item.id === scope ? 'is-active' : ''}`}
                        >
                            {item.name}
                        </button>
                    ))}
                </div>
            )}
        </>
    );
};

export default SearchTabs;
