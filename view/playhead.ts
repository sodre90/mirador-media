import { useEffect, useRef, useState, type RefObject } from "react";
import { keepPausedSeeksShowing } from "./paused-seeks.ts";

export interface Playhead {
  time: number;
  playing: boolean;
  duration: number;
}

type FrameCallbackVideo = HTMLVideoElement & { requestVideoFrameCallback?: (callback: () => void) => number; cancelVideoFrameCallback?: (handle: number) => void };

/**
 * Where the video is, as each frame shows where the browser can say so, and on its events otherwise. `onFrame` runs with
 * every new time, so playback can be held inside a trim to the frame.
 */
export function usePlayhead(video: RefObject<HTMLVideoElement | null>, source: string | null, onFrame: (time: number) => void): Playhead {
  const [playhead, setPlayhead] = useState<Playhead>({ time: 0, playing: false, duration: 0 });
  const framesShown = useRef(0);
  useEffect(() => {
    const element = video.current as FrameCallbackVideo | null;
    if (!element) return;
    let handle = 0;
    const read = () => {
      onFrame(element.currentTime);
      setPlayhead({ time: element.currentTime, playing: !element.paused, duration: Number.isFinite(element.duration) ? element.duration : 0 });
    };
    const eachFrame = () => {
      framesShown.current += 1;
      read();
      handle = element.requestVideoFrameCallback?.(eachFrame) ?? 0;
    };
    const events = ["loadedmetadata", "timeupdate", "seeked", "play", "pause", "ended"];
    events.forEach((name) => element.addEventListener(name, read));
    handle = element.requestVideoFrameCallback?.(eachFrame) ?? 0;
    return () => {
      events.forEach((name) => element.removeEventListener(name, read));
      element.cancelVideoFrameCallback?.(handle);
    };
  }, [video, source, onFrame]);
  useEffect(() => {
    const element = video.current as FrameCallbackVideo | null;
    if (!element?.requestVideoFrameCallback) return;
    return keepPausedSeeksShowing(element, () => framesShown.current);
  }, [video, source]);
  return playhead;
}
