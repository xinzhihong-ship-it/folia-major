import type { LoginState, OnlineMusicProvider, ProviderLyricsResult, ProviderUser } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { extractAwlrcContainer } from '../../../utils/lyrics/awlrcContainer';
import { parseLyricsByFormat } from '../../../utils/lyrics/parserCore';
import { hasRenderableLyrics } from '../../../utils/lyrics/validity';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { getLxmusicTransportAvailability, requestLxmusic, subscribeLxmusicEvents } from './lxmusicTransport';
import { LXMUSIC_PROVIDER_ID, lxMusicInfoOf, normalizeLxmusicList, normalizeLxmusicSong } from './lxmusicNormalize';
import { forgetKeptLxLists, lxmusicCatalog, lxmusicLibrary, lxmusicMutations, lxmusicSearch } from './lxmusicLibrary';
import { createLxmusicExternalPlayback } from './lxmusicPlayback';
import { describeLxmusicFailure } from './lxmusicFailure';

// src/services/onlineMusic/lxmusic/lxmusicProvider.ts
// 洛雪音乐（lx-music-desktop-enhanced）：在 Folia 里搜歌、读我的列表、打开分享的歌单，播放由洛雪完成
// （外部播放路线的「播放器主导」：洛雪自己的音源、音质、播放引擎与输出设备照常生效，Folia 跟着显示歌词）。
// 不登录账号：洛雪开着「Folia 对接」时，「连接」一下就算登录了；之后洛雪没开时，读取会说「本地服务未启动」。

interface LxLinkStatus { linked: boolean; connected: boolean; appVersion?: string | null }

const LX_USER: ProviderUser = { id: 'lxmusic-local', nickname: '洛雪音乐' };

// 洛雪的歌词经洛雪自己的歌词引擎（含绑定、跨平台匹配和偏移），回来的是 `[awlrc:...]` 容器：原文、翻译、罗马音、逐字四轨
async function readLyrics(song: Parameters<NonNullable<OnlineMusicProvider['lyrics']>['getLyrics']>[0]): Promise<ProviderLyricsResult> {
    const answer = await requestLxmusic<{ content?: string | null } | null>('lyric', { musicInfo: lxMusicInfoOf(song) });
    const tracks = extractAwlrcContainer(answer?.content ?? '');
    const main = tracks?.awlrc ? { format: 'awlrc' as const, text: tracks.awlrc } : tracks?.lrc ? { format: 'lrc' as const, text: tracks.lrc } : null;
    if (!tracks || !main) return { lyrics: null, isPureMusic: false };
    const lyrics = parseLyricsByFormat(main.format, main.text, tracks.tlrc ?? '', {}, tracks.rlrc ?? '');
    return {
        lyrics: hasRenderableLyrics(lyrics) ? lyrics : null,
        mainText: tracks.lrc ?? null,
        wordByWordText: tracks.awlrc ?? null,
        translationText: tracks.tlrc ?? null,
        romanizationText: tracks.rlrc ?? null,
        isPureMusic: false,
    };
}

const readLinkStatus = () => requestLxmusic<LxLinkStatus>('linkStatus');

export const lxmusicProvider: OnlineMusicProvider = {
    id: LXMUSIC_PROVIDER_ID,
    displayName: '洛雪音乐',
    shortName: '洛雪',
    shortNameKey: 'onlineProviderName.lxmusic',
    mark: { letter: '洛', color: '#3b82f6' },
    getAvailability: getLxmusicTransportAvailability,
    describeFailure: describeLxmusicFailure,
    // 列表变了（在洛雪里增删歌、新建列表）：留着的整张列表作废，下次读到新的
    watch() {
        return subscribeLxmusicEvents(event => {
            if (event.type === 'lists') forgetKeptLxLists();
        });
    },
    capabilities: {
        search: true, playback: false, externalPlayback: true, lyrics: true, wordByWordLyrics: true, auth: true,
        userLibrary: true, playlists: true, albums: false, artists: false, recommendations: false,
        mutations: true, likes: true, playlistTrackMutations: true, playlistSubscription: true,
    },
    normalizeSong: raw => normalizeLxmusicSong(raw),
    normalizeCollection: raw => normalizeLxmusicList(raw as Parameters<typeof normalizeLxmusicList>[0]),
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    search: lxmusicSearch,
    library: lxmusicLibrary,
    catalog: lxmusicCatalog,
    mutations: lxmusicMutations,
    lyrics: { getLyrics: readLyrics, prefersOwnWordByWord: true },
    externalPlayback: createLxmusicExternalPlayback(),
    auth: {
        getLoginTexts: () => ({ title: 'home.loginTitleLxmusic', note: 'home.loginNoteLxmusic' }),
        // 没有账号要填：表单只有一个「连接」按钮。洛雪没开、或没开「Folia 对接」时提示去打开
        getLoginForm: () => ({
            fields: [],
            submitLabelKey: 'lxmusic.connect',
            noteKey: 'lxmusic.connectNote',
            errorKeys: {
                unavailable: 'lxmusic.errorNotRunning',
                network: 'lxmusic.errorNotRunning',
                'invalid-response': 'lxmusic.errorBadResponse',
            },
        }),
        async submitLoginForm() {
            await requestLxmusic('link');
        },
        async getLoginStatus() {
            return (await readLinkStatus()).linked ? LX_USER : null;
        },
        // 连接过一次就记着：洛雪之后关着也照样显示，读取时再说没连上
        showsKeptAccountAtStart: true,
        async logout() {
            await requestLxmusic('unlink');
        },
        startLogin(): Promise<string> {
            return Promise.reject(new OnlineProviderError('unavailable', 'Connect LX Music from the sign-in window', LXMUSIC_PROVIDER_ID));
        },
        async checkLogin(): Promise<LoginState> {
            return (await readLinkStatus()).linked ? { state: 'confirmed' } : { state: 'waiting' };
        },
        describeLoginFailure: (_step, error) => {
            if (error instanceof OnlineProviderError && error.code === 'unavailable') return { case: 'local-service-unavailable', code: typeof error.cause === 'string' ? error.cause : 'unavailable' };
            return null;
        },
    },
};
