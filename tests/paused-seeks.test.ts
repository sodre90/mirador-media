import { describe, expect, test } from "bun:test";
import { keepPausedSeeksShowing } from "../view/paused-seeks.ts";

const WAIT_MS = 5;

/** A video whose play moves its time on a little, as a real one does before it pauses again. */
class FakeVideo extends EventTarget {
  paused = true;
  seeking = false;
  currentTime = 0;
  muted = false;
  framesShown = 0;
  playedMuted: boolean[] = [];

  async play() {
    this.playedMuted.push(this.muted);
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    this.currentTime += 0.03;
  }

  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  seek(seconds: number, { shows }: { shows: boolean }) {
    this.dispatchEvent(new Event("seeking"));
    this.currentTime = seconds;
    if (shows) this.framesShown += 1;
    this.dispatchEvent(new Event("seeked"));
  }
}

function watched() {
  const video = new FakeVideo();
  const stop = keepPausedSeeksShowing(video as unknown as HTMLVideoElement, () => video.framesShown, WAIT_MS);
  const playedByUser = async () => {
    await video.play();
    video.pause();
  };
  return { video, stop, playedByUser };
}

const checked = () => Bun.sleep(WAIT_MS * 4);

describe("seeking while paused", () => {
  test("before any play, a seek that shows no frame is left alone", async () => {
    const { video } = watched();
    video.seek(10, { shows: false });
    await checked();
    expect(video.playedMuted).toEqual([]);
  });

  test("after the user played and paused, a seek that shows no frame plays muted for an instant and lands where it was asked", async () => {
    const { video, playedByUser } = watched();
    await playedByUser();
    video.seek(41.5, { shows: false });
    await checked();
    expect(video.playedMuted).toEqual([false, true]);
    expect(video.paused).toBe(true);
    expect(video.muted).toBe(false);
    expect(video.currentTime).toBe(41.5);

    video.seek(83.2, { shows: false });
    await checked();
    expect(video.playedMuted, "once per pause").toHaveLength(2);
  });

  test("a seek that shows its frame after the pause needs nothing, then or later", async () => {
    const { video, playedByUser } = watched();
    await playedByUser();
    video.seek(41.5, { shows: true });
    await checked();
    video.seek(83.2, { shows: false });
    await checked();
    expect(video.playedMuted).toEqual([false]);
  });

  test("each play and pause of the user's gets its own", async () => {
    const { video, playedByUser } = watched();
    await playedByUser();
    video.seek(41.5, { shows: false });
    await checked();
    await playedByUser();
    video.seek(83.2, { shows: false });
    await checked();
    expect(video.playedMuted).toEqual([false, true, false, true]);
    expect(video.currentTime).toBe(83.2);
  });

  test("waits while the user still drags, and checks where the drag ends", async () => {
    const { video, playedByUser } = watched();
    await playedByUser();
    video.seek(30, { shows: false });
    video.seeking = true;
    await checked();
    expect(video.playedMuted).toHaveLength(1);
    video.seeking = false;
    video.seek(31, { shows: false });
    video.seek(32, { shows: false });
    await checked();
    expect(video.playedMuted).toHaveLength(2);
    expect(video.currentTime).toBe(32);
  });

  test("hears nothing once stopped", async () => {
    const { video, stop, playedByUser } = watched();
    await playedByUser();
    video.seek(41.5, { shows: false });
    stop();
    await checked();
    expect(video.playedMuted).toEqual([false]);
  });
});
