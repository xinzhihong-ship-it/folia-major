import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderQualityChoiceEvent, ProviderQualityChoices } from '@/types/onlineMusic';

// test/unit/onlineMusic/playerQualityChoices.test.ts
// 播放器自己的音质档：音质选择开着时读一次、跟着播放器的改动；在这里选的一档马上亮起，刚选的那一会儿
// 不被播放器还没听到的旧设置盖回去，发不出去时退回原来那档。播放器断开时不列它的档，连上、说话时重读不漏。

const omniMock = vi.hoisted(() => ({
    readExternalPlayerQualityChoices: vi.fn<(providerId: string) => Promise<ProviderQualityChoices | null>>(),
    watchExternalPlayerQualityChoice: vi.fn<(providerId: string, listen: (event: ProviderQualityChoiceEvent) => void) => () => void>(),
    setExternalPlayerQualityChoice: vi.fn<(providerId: string, choice: string) => Promise<void>>(async () => {}),
}));

vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const { getPlayerQualityChoices, setPlayerQualityChoice, subscribePlayerQualityChoices } = await import('@/services/onlineMusic/playerQualityChoices');

const levels = (current: string): ProviderQualityChoices => ({
    choices: [{ id: '128k', label: '128K 普音' }, { id: 'flac', label: 'FLAC 无损' }, { id: 'master', label: '臻品母带' }],
    current,
});

const setting = (current: string): ProviderQualityChoiceEvent => ({ type: 'setting', current });
const reachable = (value: boolean): ProviderQualityChoiceEvent => ({ type: 'reachable', reachable: value });

describe('player quality choices', () => {
    // 每条用自己的平台 id：模块里按平台留着的状态不跨用例
    let listen: (event: ProviderQualityChoiceEvent) => void = () => {};
    const stopWatch = vi.fn();
    let unsubscribe: () => void = () => {};

    beforeEach(() => {
        vi.useFakeTimers();
        for (const mock of Object.values(omniMock)) mock.mockReset();
        omniMock.setExternalPlayerQualityChoice.mockResolvedValue(undefined);
        omniMock.watchExternalPlayerQualityChoice.mockImplementation((_providerId, heard) => { listen = heard; return stopWatch; });
        stopWatch.mockClear();
    });

    afterEach(() => {
        unsubscribe();
        unsubscribe = () => {};
        vi.useRealTimers();
    });

    it('reads the levels once someone looks, follows each change, and stops when nobody looks', async () => {
        omniMock.readExternalPlayerQualityChoices.mockResolvedValue(levels('flac'));
        const notified = vi.fn();
        unsubscribe = subscribePlayerQualityChoices('player1', notified);
        await vi.advanceTimersByTimeAsync(0);
        expect(getPlayerQualityChoices('player1')?.current).toBe('flac');
        const before = getPlayerQualityChoices('player1');
        listen(setting('flac'));
        expect(getPlayerQualityChoices('player1')).toBe(before);
        listen(setting('master'));
        expect(getPlayerQualityChoices('player1')?.current).toBe('master');
        expect(notified).toHaveBeenCalledTimes(2);
        unsubscribe();
        unsubscribe = () => {};
        expect(stopWatch).toHaveBeenCalledTimes(1);
    });

    it('lights a pick at once and keeps it over an older word of the player, then takes the player word again', async () => {
        omniMock.readExternalPlayerQualityChoices.mockResolvedValue(levels('flac'));
        unsubscribe = subscribePlayerQualityChoices('player2', () => {});
        await vi.advanceTimersByTimeAsync(0);
        setPlayerQualityChoice('player2', 'master');
        expect(getPlayerQualityChoices('player2')?.current).toBe('master');
        expect(omniMock.setExternalPlayerQualityChoice).toHaveBeenCalledWith('player2', 'master');
        listen(setting('flac'));
        expect(getPlayerQualityChoices('player2')?.current).toBe('master');
        await vi.advanceTimersByTimeAsync(2500);
        listen(setting('128k'));
        expect(getPlayerQualityChoices('player2')?.current).toBe('128k');
    });

    it('goes back to the level it had when the pick could not be set', async () => {
        omniMock.readExternalPlayerQualityChoices.mockResolvedValue(levels('flac'));
        omniMock.setExternalPlayerQualityChoice.mockRejectedValue(new Error('not running'));
        unsubscribe = subscribePlayerQualityChoices('player3', () => {});
        await vi.advanceTimersByTimeAsync(0);
        setPlayerQualityChoice('player3', 'master');
        await vi.advanceTimersByTimeAsync(0);
        expect(getPlayerQualityChoices('player3')?.current).toBe('flac');
    });

    it('does not lose the word of a player that was still starting when it was first asked', async () => {
        let fail: (error: Error) => void = () => {};
        omniMock.readExternalPlayerQualityChoices
            .mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
            .mockResolvedValue(levels('flac'));
        unsubscribe = subscribePlayerQualityChoices('player4', () => {});
        // 第一次读还没回来，播放器已经推来了设置
        listen(setting('flac'));
        await vi.advanceTimersByTimeAsync(1000);
        fail(new Error('timed out'));
        await vi.advanceTimersByTimeAsync(0);
        expect(getPlayerQualityChoices('player4')).toBeNull();
        await vi.advanceTimersByTimeAsync(5000);
        expect(getPlayerQualityChoices('player4')?.current).toBe('flac');
        expect(omniMock.readExternalPlayerQualityChoices).toHaveBeenCalledTimes(2);
    });

    it('lists no levels while the player cannot be reached, and reads them when it can again', async () => {
        omniMock.readExternalPlayerQualityChoices.mockResolvedValue(levels('flac'));
        unsubscribe = subscribePlayerQualityChoices('player5', () => {});
        await vi.advanceTimersByTimeAsync(0);
        listen(reachable(false));
        expect(getPlayerQualityChoices('player5')).toBeNull();
        omniMock.readExternalPlayerQualityChoices.mockResolvedValue(levels('master'));
        listen(reachable(true));
        await vi.advanceTimersByTimeAsync(0);
        expect(getPlayerQualityChoices('player5')?.current).toBe('master');
    });

    it('does not ask a player without levels again at each word, only once it is reached anew', async () => {
        omniMock.readExternalPlayerQualityChoices.mockResolvedValue(null);
        unsubscribe = subscribePlayerQualityChoices('player6', () => {});
        await vi.advanceTimersByTimeAsync(0);
        listen(setting('flac'));
        await vi.advanceTimersByTimeAsync(10_000);
        listen(setting('320k'));
        await vi.advanceTimersByTimeAsync(10_000);
        expect(omniMock.readExternalPlayerQualityChoices).toHaveBeenCalledTimes(1);
        omniMock.readExternalPlayerQualityChoices.mockResolvedValue(levels('320k'));
        listen(reachable(true));
        await vi.advanceTimersByTimeAsync(0);
        expect(getPlayerQualityChoices('player6')?.current).toBe('320k');
    });
});
