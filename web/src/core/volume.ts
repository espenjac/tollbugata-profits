import { osloParts } from "./dates";
import { marketSession } from "./session";

const SESSION_OPEN_MINUTES = 9 * 60;
const SESSION_CLOSE_MINUTES = 16 * 60 + 30;

/**
 * Approximate share of a normal Oslo Børs day that has traded by a given time.
 *
 * The scanner reports today's cumulative volume, while the comparison value is
 * a full-day 10-day average. A simple linear curve would make every stock look
 * quiet in the morning and busy at the close. Oslo is U-shaped: the opening and
 * closing hours carry more volume than the middle of the day. The points below
 * are deliberately rough; they only need to keep the volume gate from rejecting
 * every liquid stock before lunch.
 */
const CUMULATIVE_VOLUME_SHARE: ReadonlyArray<readonly [number, number]> = [
  [SESSION_OPEN_MINUTES, 0],
  [9 * 60 + 30, 0.13],
  [10 * 60, 0.21],
  [11 * 60, 0.33],
  [12 * 60, 0.43],
  [13 * 60, 0.52],
  [14 * 60, 0.62],
  [15 * 60, 0.73],
  [16 * 60, 0.88],
  [SESSION_CLOSE_MINUTES, 1],
];

function interpolate(minutes: number): number {
  for (let index = 1; index < CUMULATIVE_VOLUME_SHARE.length; index += 1) {
    const [endMinute, endShare] = CUMULATIVE_VOLUME_SHARE[index];
    if (minutes <= endMinute) {
      const [startMinute, startShare] = CUMULATIVE_VOLUME_SHARE[index - 1];
      const span = endMinute - startMinute;
      if (span <= 0) {
        return endShare;
      }
      const progress = (minutes - startMinute) / span;
      return startShare + (endShare - startShare) * progress;
    }
  }
  return 1;
}

/**
 * How much of a normal trading day's volume has printed by `now` (0–1).
 * Outside the session the day is complete, so the share is 1. Before the
 * opening auction it is 0 because there is no meaningful pace yet.
 */
export function expectedVolumeShare(now: Date = new Date()): number {
  const session = marketSession(now);
  if (session === "closed") {
    return 1;
  }
  if (session === "pre") {
    return 0;
  }
  const parts = osloParts(now);
  const minutes = Math.max(
    SESSION_OPEN_MINUTES,
    Math.min(SESSION_CLOSE_MINUTES, parts.hour * 60 + parts.minute),
  );
  return interpolate(minutes);
}

/**
 * Converts a raw cumulative volume ratio (today's volume divided by the
 * 10-day average daily volume) into a pace ratio relative to the time of day.
 *
 * A pace of 1 means the stock has traded exactly on its normal pace, 0.7 means
 * it is 30 % behind, and 2 means twice the normal pace. This is the value that
 * should be compared with fixed thresholds; comparing the raw ratio early in
 * the day rejects liquid stocks simply because the session has just started.
 *
 * Returns null when there is no meaningful volume signal. Outside the session
 * the raw ratio is returned unchanged.
 */
export function timeWeightedVolumeRatio(
  rawRatio: number | null,
  now: Date = new Date(),
): number | null {
  if (rawRatio === null || !Number.isFinite(rawRatio) || rawRatio < 0) {
    return null;
  }
  const share = expectedVolumeShare(now);
  if (share <= 0) {
    return null;
  }
  return rawRatio / share;
}
