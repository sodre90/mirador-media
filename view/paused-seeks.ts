const SEEK_SHOWS_WITHIN_MS = 250;

/** The parts of a video element that seeking while paused depends on. */
export type SeekableVideo = Pick<HTMLVideoElement, "paused" | "seeking" | "currentTime" | "muted" | "play" | "pause" | "addEventListener" | "removeEventListener">;

/**
 * After the user plays and pauses a video in the desktop app's WebKit, a seek while paused decodes no frame until the
 * video plays again: the time moves and the picture stays. So once after each such pause, a seek that shows no new frame
 * plays the video muted for an instant, and seeks again to where it was asked to go, which then shows. `framesShown`
 * counts the frames the video presented, as its frame callbacks tell; a seek's frame may come before its seeked event,
 * so the count is taken as the seek starts. Returns the function that stops it.
 */
export function keepPausedSeeksShowing(video: SeekableVideo, framesShown: () => number, wait = SEEK_SHOWS_WITHIN_MS) {
  let armed = false;
  let replaying = false;
  let check: ReturnType<typeof setTimeout> | undefined;
  let shownWhenSeekStarted = 0;

  const replay = async (target: number) => {
    replaying = true;
    const muted = video.muted;
    video.muted = true;
    try {
      await video.play();
      video.pause();
      video.currentTime = target;
    } catch {
      replaying = false;
    } finally {
      video.muted = muted;
    }
  };
  const played = () => {
    if (!replaying) armed = false;
  };
  const paused = () => {
    if (replaying) replaying = false;
    else armed = true;
  };
  const seekStarted = () => {
    shownWhenSeekStarted = framesShown();
  };
  const sought = () => {
    if (!armed || replaying || !video.paused || video.seeking) return;
    const target = video.currentTime;
    const shownBefore = shownWhenSeekStarted;
    clearTimeout(check);
    check = setTimeout(() => {
      if (!armed || replaying || !video.paused || video.seeking || video.currentTime !== target) return;
      armed = false;
      if (framesShown() === shownBefore) void replay(target);
    }, wait);
  };

  video.addEventListener("play", played);
  video.addEventListener("pause", paused);
  video.addEventListener("seeking", seekStarted);
  video.addEventListener("seeked", sought);
  return () => {
    clearTimeout(check);
    video.removeEventListener("play", played);
    video.removeEventListener("pause", paused);
    video.removeEventListener("seeking", seekStarted);
    video.removeEventListener("seeked", sought);
  };
}
