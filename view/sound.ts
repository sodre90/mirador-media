import { useEffect, useRef, type RefObject } from "react";

interface Route {
  element: HTMLVideoElement;
  gain: GainNode;
}

/**
 * Plays the video's sound through a gain, as loud as `level` times the recording, which an element's own volume can't go
 * above. The route is made the first time playback starts while `wanted`, as the browser lets sound start only then, and
 * an element keeps its route for good.
 */
export function useSoundLevel(video: RefObject<HTMLVideoElement | null>, level: number, wanted: boolean, playing: boolean) {
  const context = useRef<AudioContext | null>(null);
  const route = useRef<Route | null>(null);
  useEffect(() => {
    const element = video.current;
    if (!element || !playing || (!wanted && route.current?.element !== element)) return;
    if (route.current?.element !== element) {
      context.current ??= new AudioContext();
      const gain = context.current.createGain();
      context.current.createMediaElementSource(element).connect(gain).connect(context.current.destination);
      route.current = { element, gain };
    }
    route.current.gain.gain.value = level;
    if (context.current?.state === "suspended") void context.current.resume();
  }, [video, level, wanted, playing]);
}
