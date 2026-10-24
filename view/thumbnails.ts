import { useEffect, useState } from "react";

const THUMBNAIL_HEIGHT = 72;

/** A frame of the filmstrip, and the moment of the video it shows. */
export interface Thumbnail {
  at: number;
  src: string;
}

/** The moments the filmstrip shows: the middle of each of `count` equal parts. */
export const thumbnailTimes = (duration: number, count: number) => Array.from({ length: count }, (_, index) => ((index + 0.5) * duration) / count);

const grabbed = new Map<string, Thumbnail[]>();

/** Draws the frame the video shows, small, as a JPEG data URL. */
function drawnFrame(video: HTMLVideoElement) {
  const width = Math.max(1, Math.round((THUMBNAIL_HEIGHT * video.videoWidth) / video.videoHeight));
  const canvas = Object.assign(document.createElement("canvas"), { width, height: THUMBNAIL_HEIGHT });
  canvas.getContext("2d")!.drawImage(video, 0, 0, width, THUMBNAIL_HEIGHT);
  return canvas.toDataURL("image/jpeg", 0.7);
}

/**
 * Frames along the video for the filmstrip, grabbed one by one in a video of their own, along its own length, and kept
 * for each address.
 */
export function useThumbnails(url: string | null, count = 20) {
  const key = url && `${count} ${url}`;
  const [thumbnails, setThumbnails] = useState<{ key: string; frames: Thumbnail[] } | null>(null);
  useEffect(() => {
    if (!key) return;
    const known = grabbed.get(key);
    if (known) return setThumbnails({ key, frames: known });
    const frames: Thumbnail[] = [];
    let times: number[] = [];
    const video = Object.assign(document.createElement("video"), { crossOrigin: "anonymous", muted: true, preload: "auto" });
    const seekNext = () => (video.currentTime = times[frames.length]!);
    const start = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      times = thumbnailTimes(video.duration, count);
      seekNext();
    };
    const grab = () => {
      frames.push({ at: times[frames.length]!, src: drawnFrame(video) });
      setThumbnails({ key, frames: [...frames] });
      if (frames.length < count) seekNext();
      else grabbed.set(key, frames);
    };
    video.addEventListener("loadedmetadata", start, { once: true });
    video.addEventListener("seeked", grab);
    video.src = url!;
    return () => {
      video.removeEventListener("seeked", grab);
      video.removeAttribute("src");
      video.load();
    };
  }, [key]);
  return thumbnails?.key === key ? thumbnails.frames : [];
}
