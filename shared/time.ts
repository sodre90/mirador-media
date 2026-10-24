const twoDigits = (value: number) => String(value).padStart(2, "0");

/** Seconds as a video player shows them, to the hundredth: 39.2 is 0:39.20, 3723.5 is 1:02:03.50. */
export function formatTime(seconds: number) {
  const hundredths = Math.round(Math.max(0, seconds) * 100);
  const [hours, minutes, wholeSeconds, fraction] = [Math.floor(hundredths / 360_000), Math.floor(hundredths / 6000) % 60, Math.floor(hundredths / 100) % 60, hundredths % 100];
  const clock = hours > 0 ? `${hours}:${twoDigits(minutes)}:${twoDigits(wholeSeconds)}` : `${minutes}:${twoDigits(wholeSeconds)}`;
  return `${clock}.${twoDigits(fraction)}`;
}

/** The frame showing at a time, counted from 0; a time a hair before a frame's start, as a float lands, counts as that frame. */
export const frameAt = (seconds: number, fps: number) => Math.floor(seconds * fps + 1e-6);

/** The middle of a frame, where a seek lands on it whatever the browser rounds. */
export const frameMiddle = (frame: number, fps: number) => (Math.max(0, frame) + 0.5) / fps;

export const formatFps = (fps: number) => String(Math.round(fps * 100) / 100);

/** A signed number of stops, as photographers write it: +0.50 EV, -1.00 EV. */
export const formatExposure = (ev: number) => `${ev > 0 ? "+" : ""}${ev.toFixed(2)} EV`;
