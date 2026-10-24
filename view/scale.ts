const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/**
 * The times the timeline's ruler names: whole steps from 0, of the smallest step that names fewer than `most`, and none
 * in the last half step, where its label would run off the end.
 */
export function rulerTicks(duration: number, most: number): number[] {
  if (duration <= 0) return [];
  const step = STEPS.find((candidate) => duration / candidate < most) ?? STEPS.at(-1)!;
  const count = Math.max(1, Math.floor((duration - step / 2) / step + 1e-9) + 1);
  return Array.from({ length: count }, (_, index) => index * step);
}

const twoDigits = (value: number) => String(value).padStart(2, "0");

/** A ruler's time, to the second unless it falls between: 0:05, 1:30, 1:02:00, 0:00.5. */
export function formatTick(seconds: number) {
  const whole = Math.floor(seconds);
  const [hours, minutes, rest] = [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60];
  const clock = hours > 0 ? `${hours}:${twoDigits(minutes)}:${twoDigits(rest)}` : `${minutes}:${twoDigits(rest)}`;
  return seconds > whole ? `${clock}.${Math.round((seconds - whole) * 10)}` : clock;
}
