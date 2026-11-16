import { createHifiClock, MAX_EXTRAPOLATION_SEC, type HifiClockSync } from '../hifi/hifiClock';

// Keep coarse external-player samples monotonic across buffering/pause/resume, not just playing ticks.
// A player that plays at another speed (`rate`) is followed at it: the time since the last sample is
// scaled before the underlying clock extrapolates it.
export function createExternalClock() {
    const clock = createHifiClock();
    let floor: number | null = null;
    let previousSample: { position: number; paused: boolean } | null = null;
    let rate = 1;
    let anchorMs: number | null = null;
    const scaled = (nowMs: number) => anchorMs === null || rate === 1 ? nowMs : anchorMs + (nowMs - anchorMs) * rate;
    const read = (nowMs = performance.now()) => Math.max(clock.read(scaled(nowMs)), floor ?? 0);
    const sync = (update: HifiClockSync & { samplePositionSec?: number; rate?: number }) => {
        const rawPosition = update.samplePositionSec ?? update.positionSec;
        const nextRate = update.rate !== undefined && Number.isFinite(update.rate) && update.rate > 0 ? update.rate : rate;
        // Repeated SDK samples do not restart extrapolation or renew its stall timeout.
        if (update.holdBackward && previousSample?.position === rawPosition && previousSample.paused === update.paused && nextRate === rate) {
            if (update.durationSec !== undefined) setDuration(update.durationSec);
            return;
        }
        previousSample = { position: rawPosition, paused: update.paused };
        const nowMs = update.nowMs ?? performance.now();
        const shown = read(nowMs);
        rate = nextRate;
        anchorMs = nowMs;
        clock.sync({ ...update, nowMs, holdBackward: false });
        const sampled = clock.read(nowMs);
        const duration = clock.state().durationSec;
        const boundedShown = duration === null ? shown : Math.min(shown, duration);
        const lag = boundedShown - sampled;
        // The route compensates up to one second of RPC age and extrapolates at most one more.
        floor = update.holdBackward && lag > 0 && lag <= 2 * MAX_EXTRAPOLATION_SEC ? boundedShown : null;
    };
    const setDuration = (duration: number | null) => {
        clock.setDuration(duration);
        if (floor !== null && duration !== null && Number.isFinite(duration) && duration > 0) floor = Math.min(floor, duration);
    };
    return { read, sync, setDuration };
}
