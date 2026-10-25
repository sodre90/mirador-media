import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import ffmpeg from "ffmpeg-static";
import ffprobe from "@derhuerst/ffprobe-static";

const miradorDir = process.env.MIRADOR_DIR ?? join(import.meta.dirname, "..", "..", "visualized-claude-sessions");
const pluginDir = process.env.MEDIA_PLUGIN_DIR ?? join(import.meta.dirname, "..");
const profileName = "media";

/** Mirador's test host and helpers, from its checkout: loaded in the hooks, as Playwright also imports this file in a process that never runs them. */
type Helpers = typeof import("../../visualized-claude-sessions/e2e/helpers.ts");
type TestHostModule = typeof import("../../visualized-claude-sessions/e2e/test-host.ts");
let mirador: Helpers;
let host: InstanceType<TestHostModule["TestHost"]>;

const prompts = () => readFileSync(join(host.root, "prompts"), "utf8");
const view = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-frame.app iframe");

/**
 * A 45 second clip of ffmpeg's test pattern, long enough to mark the moment the acceptance names, 0:39, with a tone. The
 * tone stops short of the end, so that Opus's padding doesn't make the clip a few milliseconds longer.
 */
function testClip(path: string) {
  const sources = ["-f", "lavfi", "-i", "testsrc2=s=320x240:r=10:d=45", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=44.5"];
  execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", ...sources, "-c:v", "libvpx", "-b:v", "300k", "-c:a", "libopus", path]);
}

/** A photo of the test pattern, 320×240, as a camera would write it. */
const testPhoto = (path: string) => execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x240", "-frames:v", "1", "-q:v", "2", path]);

const durationOf = (path: string) => Number(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" }));

test.beforeAll(async () => {
  const { TestHost, writeBunProgram } = (await import(join(miradorDir, "e2e", "test-host.ts"))) as TestHostModule;
  mirador = (await import(join(miradorDir, "e2e", "helpers.ts"))) as Helpers;
  host = new TestHost({ fakePrograms: true });
  writeBunProgram(host.fakeProgramsDir, "opencode", join(miradorDir, "e2e", "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  writeFileSync(join(host.root, "prompts"), "");
  mkdirSync(join(host.dataDir, "plugins"), { recursive: true });
  symlinkSync(pluginDir, join(host.dataDir, "plugins", "media"));
  await host.start();
  testClip(join(host.projectDir, "clip.webm"));
  testPhoto(join(host.projectDir, "photo.jpg"));
});
test.afterAll(async () => {
  await host?.stop();
  await host?.cleanUp();
});

/** The fake agent offers no model to pick, so this is Mirador's startConversation without that wait. */
async function startConversation(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

/** Signs in, adds the project and the fake agent's profile unless an earlier test did, and starts a conversation with it. */
async function startWithTheAgent(page: Page) {
  await mirador.signIn(page, host);
  const [newConversation, addProject] = [page.getByRole("button", { name: "+ New conversation" }), page.getByRole("button", { name: "+ Add a project directory" })];
  await expect(newConversation.or(addProject)).toBeVisible();
  if (await addProject.isVisible()) {
    await mirador.addWorkspace(page, host.projectDir);
    const profiles = await mirador.createProfile(page, profileName, "", "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
  }
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const conversation = await startConversation(page);
  await mirador.sendMessage(page, "Start");
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
  return conversation;
}

/** Drags across the frame between two points given as fractions of it, as the user draws a box. */
async function drawBox(page: Page, from: [number, number], to: [number, number]) {
  const frame = (await view(page).locator(".frame").boundingBox())!;
  const at = ([x, y]: [number, number]) => [frame.x + frame.width * x, frame.y + frame.height * y] as const;
  await page.mouse.move(...at(from));
  await page.mouse.down();
  await page.mouse.move(...at([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]));
  await page.mouse.move(...at(to));
  await page.mouse.up();
}

interface Sample {
  time: number;
  rate: number;
  level: number | null;
  filter: string;
}

type RecordingWindow = Window & { shownFrames?: number[]; samples?: Sample[]; soundLevel?: () => number };

/** Listens to whatever a page plays through Web Audio, for soundLevel to say how loud it is now. */
function tapTheSound() {
  const connect = AudioNode.prototype.connect as (this: AudioNode, destination: AudioNode, ...rest: number[]) => AudioNode;
  AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode, ...rest: number[]) {
    if (destination instanceof AudioDestinationNode) {
      const analyser = this.context.createAnalyser();
      connect.call(this, analyser);
      const samples = new Float32Array(analyser.fftSize);
      (window as RecordingWindow).soundLevel = () => {
        analyser.getFloatTimeDomainData(samples);
        return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      };
    }
    return connect.call(this, destination, ...rest);
  } as typeof AudioNode.prototype.connect;
}

/**
 * Records the time of every frame the video shows from now on, and every 50 ms its time, speed, sound level and filter,
 * until it pauses, for playback to read.
 */
const recordPlayback = (page: Page) =>
  view(page)
    .locator("video")
    .evaluate((element: HTMLVideoElement) => {
      const recording = window as RecordingWindow;
      const [shown, samples]: [number[], Sample[]] = [(recording.shownFrames = []), (recording.samples = [])];
      const each = (_now: number, frame: { mediaTime: number }) => {
        shown.push(frame.mediaTime);
        element.requestVideoFrameCallback(each);
      };
      element.requestVideoFrameCallback(each);
      const sampling = setInterval(() => {
        samples.push({ time: element.currentTime, rate: element.playbackRate, level: recording.soundLevel?.() ?? null, filter: getComputedStyle(element).filter });
      }, 50);
      element.addEventListener("pause", () => clearInterval(sampling), { once: true });
    });

const playback = (page: Page) =>
  view(page)
    .locator("video")
    .evaluate(() => ({ shownFrames: (window as RecordingWindow).shownFrames!, samples: (window as RecordingWindow).samples! }));

const between = (samples: Sample[], from: number, to: number) => samples.filter(({ time }) => time > from && time < to);

const sizeOf = (path: string) =>
  execFileSync(ffprobe, ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path], { encoding: "utf8" }).trim();

/** The frame as the pane shows it, shrunk to 24×32 cells of their average colour, so that two pictures compare coarsely. */
async function frameCells(page: Page) {
  const shot = await view(page).locator(".frame").screenshot();
  return execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vf", "scale=24:32:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { input: shot });
}

function correlation(a: number[], b: number[]) {
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const [meanA, meanB] = [mean(a), mean(b)];
  const spread = (values: number[], average: number) => Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0));
  return a.reduce((sum, value, index) => sum + (value - meanA) * (b[index]! - meanB), 0) / (spread(a, meanA) * spread(b, meanB));
}

/** How wide the filmstrip's first frame was grabbed, at the thumbnails' height of 72 px: it has the shown file's shape. */
const thumbnailWidth = (page: Page) => view(page).locator(".filmstrip img").first().evaluate((img: HTMLImageElement) => img.naturalWidth);

/** The moment the filmstrip's last frame shows: the middle of the last of its 20 parts of the shown file. */
const lastThumbnailAt = async (page: Page) => Number(await view(page).locator(".filmstrip img").last().getAttribute("data-at"));

const channel = (cells: Buffer, which: number) => [...cells].filter((_, index) => index % 3 === which);

/**
 * How alike two pictures' cells are, as the least correlation of their red, green and blue. Not their difference: Chrome
 * applies the preview's CSS brightness() to colours of its own, so a brightened preview's colours stray from the render's
 * while its layout must match.
 */
const likeness = (a: Buffer, b: Buffer) => Math.min(...[0, 1, 2].map((which) => correlation(channel(a, which), channel(b, which))));

test("mark 0:39 with a box and send 'too dark here'; the agent trims, cuts, slows, mutes and brightens it, the pane previews that, and the render can be compared", async ({ page }) => {
  await page.addInitScript(tapTheSound);
  const conversation = await startWithTheAgent(page);

  await test.step("the agent opens the video in the app, which reads its size, length and frame rate", async () => {
    expect(await mirador.callCanvasTool(host, conversation, "app_open", { app: "media", file: "clip.media.json" })).toContain("No video or photo yet.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "source", file: "clip.webm" } })).toBe("Opened clip.webm.");
    await expect(view(page).locator("header")).toContainText("clip.webm");
    await expect(view(page).locator(".facts")).toHaveText("320×240 · 10 fps · 0:45.00");
    expect(await mirador.callCanvasTool(host, conversation, "app_state", {})).toContain("Video: clip.webm, 320×240, 10 fps, 0:45.00, with sound.");
    await expect(view(page).locator(".timeline .label")).toHaveText(["Video", "Marks"]);
    await expect(view(page).locator(".timeline .tick-label")).not.toHaveCount(0);
    await expect(view(page).locator(".filmstrip img")).toHaveCount(20, { timeout: 20_000 });
    expect(await thumbnailWidth(page)).toBe(96);
    expect(await lastThumbnailAt(page)).toBeCloseTo((19.5 / 20) * 45, 0);
  });

  await test.step("the user marks 0:39 with a box and sends what's wrong there, with the frame", async () => {
    await view(page).locator("video").evaluate((element: HTMLVideoElement) => void (element.currentTime = 39.05));
    await expect(view(page).getByLabel("Current time")).toHaveText("0:39.05 / 0:45.00");
    await drawBox(page, [0.25, 0.25], [0.75, 0.75]);
    await expect(view(page).locator(".composer .when")).toHaveText("at 0:39.05");
    await expect(view(page).getByLabel("Current time")).toHaveAttribute("title", "Frame 390");
    await expect(view(page).getByRole("button", { name: "Clear the box" })).toHaveText("▢ 160×120 ×");
    await view(page).getByLabel("What's wrong here").fill("too dark here");
    await view(page).getByRole("button", { name: "Send to the agent" }).click();
    await expect(view(page).locator(".composer [role=status]")).toHaveText("Sent to the agent as m1.");
    await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
    await expect.poll(prompts).toContain(
      "About clip.media.json, open in Media (app_state reads it, apply changes it):\n\nIn clip.webm at 0:39.05 (frame 390), in the box x 80, y 60, 160×120 px of the 320×240 frame: too dark here",
    );
    const sent = page.locator(".timeline:visible .message.user").last();
    await expect.poll(() => sent.locator(".message-images img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);
    expect(await mirador.callCanvasTool(host, conversation, "app_state", {})).toContain("- m1 at 0:39.05, box x 80, y 60, 160×120 px: too dark here");
    await expect(view(page).locator(".box")).toHaveCount(1);
  });

  await test.step("the agent trims, cuts, slows, mutes and brightens it, and the pane previews all of it at once", async () => {
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "trim", start: 30, end: 42 } })).toBe("Trimmed to 0:30.00–0:42.00.");
    await expect(view(page).locator(".timeline .removed.trim")).toHaveCount(2);
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "cut", start: 33, end: 35 } })).toBe("Cut 0:33.00–0:35.00 out.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "exposure", ev: 1 } })).toBe("Set the exposure to +1.00 EV.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "mark-done", mark: "m1" } })).toBe("Marked m1 done.");
    await expect(view(page).locator(".chip")).toHaveText(["Exposure +1.00 EV×"]);
    await expect(view(page).locator(".timeline .removed")).toHaveCount(3);
    await expect(view(page).locator(".timeline .removed.cut")).toHaveAttribute("title", "Cut: 0:33.00–0:35.00");
    await expect(view(page).locator(".timeline .mark.done .pin")).toHaveText("1");
    expect(await mirador.callCanvasTool(host, conversation, "app_state", {})).toContain("The result is 0:10.00 long, in 2 pieces.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "speed", rate: 0.5, start: 35, end: 36 } })).toBe("Set the speed to 0.5× from 0:35.00 to 0:36.00.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "volume", level: 0, start: 38, end: 42 } })).toBe("Set the volume to 0% (muted) from 0:38.00 to 0:42.00.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "exposure", ev: 2, start: 40, end: 42 } })).toBe("Set the exposure to +2.00 EV from 0:40.00 to 0:42.00.");
    await expect(view(page).locator(".chip")).toHaveText(["Exposure +1.00 EV×"]);
    expect(await mirador.callCanvasTool(host, conversation, "app_state", {})).toContain("The result is 0:11.00 long, in 2 pieces.");
    await expect(view(page).locator("video")).toHaveCSS("filter", "brightness(2)");
    await expect(view(page).locator(".timeline .label")).toHaveText(["Video", "Exposure", "Speed", "Volume", "Marks"]);
    await expect(view(page).locator(".timeline .bar")).toHaveText(["+2.00 EV", "0.5×", "0% (muted)"]);
    await expect(view(page).getByLabel("m1 done")).toBeChecked();

    await view(page).locator("video").evaluate((element: HTMLVideoElement) => void (element.currentTime = 32.5));
    await expect(view(page).getByLabel("Current time")).toHaveText("0:32.50 / 0:45.00");
    await recordPlayback(page);
    await view(page).getByRole("button", { name: "Play" }).click();
    await expect(view(page).getByLabel("Current time")).toHaveText("0:42.00 / 0:45.00", { timeout: 20_000 });
    await expect(view(page).getByRole("button", { name: "Play" })).toBeVisible();
    const { shownFrames, samples } = await playback(page);
    expect(shownFrames.filter((time) => time > 33.15 && time < 34.95)).toEqual([]);
    expect(shownFrames.some((time) => time > 32.5 && time < 33)).toBe(true);
    expect(shownFrames.some((time) => time >= 35 && time < 36)).toBe(true);
    const slowed = between(samples, 35.1, 35.9);
    expect(slowed.length).toBeGreaterThan(5);
    expect(new Set(slowed.map(({ rate }) => rate))).toEqual(new Set([0.5]));
    expect(new Set(between(samples, 36.2, 41.8).map(({ rate }) => rate))).toEqual(new Set([1]));
    const [loud, muted] = [between(samples, 36.2, 37.8), between(samples, 38.3, 41.8)];
    expect([loud.length, muted.length].every((count) => count > 5)).toBe(true);
    expect(Math.min(...loud.map(({ level }) => level!))).toBeGreaterThan(0.01);
    expect(Math.max(...muted.map(({ level }) => level!))).toBeLessThan(0.002);
    expect(new Set(between(samples, 36.2, 39.8).map(({ filter }) => filter))).toEqual(new Set(["brightness(2)"]));
    expect(new Set(between(samples, 40.2, 41.8).map(({ filter }) => filter))).toEqual(new Set(["brightness(4)"]));
  });

  await test.step("the agent crops, turns and straightens the frame, and the user draws a box on the frame as the pane shows it", async () => {
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "crop", x: 80, y: 60, width: 160, height: 120 } })).toBe("Cropped to x 80, y 60, 160×120 px.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "turn", degrees: 90 } })).toBe("Turned 90° clockwise.");
    await expect.poll(async () => view(page).locator(".frame").boundingBox().then((frame) => +(frame!.width / frame!.height).toFixed(2))).toBe(0.75);
    await drawBox(page, [0, 0], [1, 0.5]);
    await expect(view(page).getByRole("button", { name: "Clear the box" })).toHaveText("▢ 80×120 ×");
    await view(page).getByRole("button", { name: "Clear the box" }).click();
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "straighten", degrees: 5 } })).toBe("Straightened 5.0° clockwise.");
    await expect(view(page).locator(".chip")).toHaveText(["Exposure +1.00 EV×", "Crop 160×120×", "Straighten 5.0°×", "Turn 90°×"]);
    expect(await mirador.callCanvasTool(host, conversation, "app_state", {})).toContain("The result is 0:11.00 long, in 2 pieces. Its frame is 120×160.");
    await view(page).getByRole("button", { name: "Source" }).click();
    await expect.poll(async () => view(page).locator(".frame").boundingBox().then((frame) => +(frame!.width / frame!.height).toFixed(2))).toBe(1.33);
    await view(page).getByRole("button", { name: "Preview" }).click();
  });

  await test.step("the agent renders, and the user compares the rendered file with the source", async () => {
    expect(await mirador.callCanvasTool(host, conversation, "app_run", { task: "render" })).toMatch(
      /^Rendered clip\.edited\.webm \(edits: trim 0:30\.00–0:42\.00; cut 0:33\.00–0:35\.00; exposure \+1\.00 EV, \+2\.00 EV from 0:40\.00 to 0:42\.00; speed 0\.5× from 0:35\.00 to 0:36\.00; volume 0% \(muted\) from 0:38\.00 to 0:42\.00; crop x 80, y 60, 160×120 px; straightened 5\.0° clockwise; turned 90° clockwise\) in \d+ s; the user can compare it with clip\.webm in the app\.$/,
    );
    const rendered = join(host.projectDir, "clip.edited.webm");
    expect(existsSync(rendered)).toBe(true);
    expect(durationOf(rendered)).toBeCloseTo(11, 0);
    expect(sizeOf(rendered)).toBe("120x160");
    await view(page).locator("video").evaluate((element: HTMLVideoElement) => void (element.currentTime = 36));
    await view(page).getByRole("button", { name: "Rendered" }).click();
    await expect(view(page).getByLabel("Current time")).toHaveText(/^0:05\.00 \/ 0:11\.\d\d$/);
    await expect(view(page).locator("video")).toHaveCSS("filter", "none");
    expect(await view(page).locator("video").evaluate((element: HTMLVideoElement) => element.playbackRate)).toBe(1);
    await expect(view(page).locator(".timeline .label")).toHaveText(["Video"]);
    await expect(view(page).locator(".filmstrip img")).toHaveCount(20, { timeout: 20_000 });
    expect(await thumbnailWidth(page)).toBe(54);
    expect(await lastThumbnailAt(page)).toBeCloseTo((19.5 / 20) * durationOf(rendered), 0);
    await view(page).getByRole("button", { name: "Source" }).click();
    await expect(view(page).getByLabel("Current time")).toHaveText("0:36.00 / 0:45.00");
    await expect(view(page).locator(".chips-note")).toHaveText("As shot · Preview shows the edits");
    await expect(view(page).locator(".chip")).toHaveCount(0);
  });

  await test.step("the preview shows the frame as the render made it", async () => {
    await view(page).getByRole("button", { name: "Preview" }).click();
    await view(page).locator("video").evaluate((element: HTMLVideoElement) => void (element.currentTime = 37.05));
    await expect(view(page).getByLabel("Current time")).toHaveText("0:37.05 / 0:45.00");
    const previewed = await frameCells(page);
    await view(page).getByRole("button", { name: "Rendered" }).click();
    await expect(view(page).getByLabel("Current time")).toHaveText(/^0:06\.05 \/ 0:11\.\d\d$/);
    await expect.poll(async () => likeness(previewed, await frameCells(page)), { timeout: 10_000 }).toBeGreaterThan(0.9);
  });
});

test("mark a box on a photo and send 'sky too bright'; the agent brightens, crops and turns it, and the render can be compared", async ({ page }) => {
  const conversation = await startWithTheAgent(page);

  await test.step("the agent opens the photo, which shows without time", async () => {
    expect(await mirador.callCanvasTool(host, conversation, "app_open", { app: "media", file: "photo.media.json" })).toContain("No video or photo yet.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "source", file: "photo.jpg" } })).toBe("Opened photo.jpg.");
    await expect(page.locator(".canvas-panel:visible .app-toggle", { hasText: "Media" })).toHaveAttribute("aria-pressed", "true");
    await expect(view(page).locator(".facts")).toHaveText("320×240");
    expect(await mirador.callCanvasTool(host, conversation, "app_state", {})).toContain("Photo: photo.jpg, 320×240.");
    await expect(view(page).locator(".frame img")).toBeVisible();
    await expect(view(page).getByLabel("Current time")).toHaveCount(0);
    await expect(view(page).getByRole("button", { name: "Start a range here" })).toHaveCount(0);
  });

  await test.step("the user draws a box on the photo and sends what's wrong there, with the photo", async () => {
    await drawBox(page, [0.25, 0.25], [0.75, 0.75]);
    await expect(view(page).getByRole("button", { name: "Clear the box" })).toHaveText("▢ 160×120 ×");
    const note = view(page).getByLabel("What's wrong here");
    await expect(note).toHaveAttribute("rows", "2");
    await note.fill("sky too bright");
    await note.press("Shift+Enter");
    await note.pressSequentially("on the left");
    await note.press("Shift+Enter");
    await note.pressSequentially("keep the clouds");
    await expect(note).toHaveValue("sky too bright\non the left\nkeep the clouds");
    await expect(note).toHaveAttribute("rows", "3");
    await note.press("Enter");
    await expect(view(page).locator(".composer [role=status]")).toHaveText("Sent to the agent as m1.");
    await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
    await expect.poll(prompts).toContain(
      "About photo.media.json, open in Media (app_state reads it, apply changes it):\n\nIn photo.jpg, in the box x 80, y 60, 160×120 px of the 320×240 photo: sky too bright\non the left\nkeep the clouds\n\n(Mark m1. The picture is the photo with the box drawn on it in red, as shot.)",
    );
    const sent = page.locator(".timeline:visible .message.user").last();
    await expect.poll(() => sent.locator(".message-images img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);
    expect(await mirador.callCanvasTool(host, conversation, "app_state", {})).toContain("- m1 box x 80, y 60, 160×120 px: sky too bright\non the left\nkeep the clouds");
    await expect(note).toHaveValue("");
    expect(await view(page).locator(".marks .note").evaluate((element: HTMLElement) => element.innerText)).toBe("sky too bright\non the left\nkeep the clouds");
    await expect(view(page).locator(".box")).toHaveCount(1);
  });

  await test.step("the agent can't trim a photo, but brightens, crops it to the pixel and turns it, and the pane previews that", async () => {
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "trim", start: 0, end: 1 } })).toContain("photo.jpg is a photo: trim works on a video's time.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "exposure", ev: 1 } })).toBe("Set the exposure to +1.00 EV.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "crop", x: 80, y: 60, width: 161, height: 121 } })).toBe("Cropped to x 80, y 60, 161×121 px.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "turn", degrees: 90 } })).toBe("Turned 90° clockwise.");
    await expect(view(page).locator(".chip")).toHaveText(["Exposure +1.00 EV×", "Crop 161×121×", "Turn 90°×"]);
    expect(await mirador.callCanvasTool(host, conversation, "app_state", {})).toContain("Its frame is 121×161.");
    await expect(view(page).locator(".frame img")).toHaveCSS("filter", "brightness(2)");
    await expect.poll(async () => view(page).locator(".frame").boundingBox().then((frame) => +(frame!.width / frame!.height).toFixed(3))).toBe(+(121 / 161).toFixed(3));
  });

  await test.step("the agent renders the photo as a JPEG, and the preview shows it as the render made it", async () => {
    expect(await mirador.callCanvasTool(host, conversation, "app_run", { task: "render" })).toMatch(
      /^Rendered photo\.edited\.jpg \(edits: exposure \+1\.00 EV; crop x 80, y 60, 161×121 px; turned 90° clockwise\) in \d+ s; the user can compare it with photo\.jpg in the app\.$/,
    );
    expect(sizeOf(join(host.projectDir, "photo.edited.jpg"))).toBe("121x161");
    await expect(view(page).locator(".task-result")).toHaveText("Rendered photo.edited.jpg.Compare it");
    const previewed = await frameCells(page);
    await view(page).getByRole("button", { name: "Compare it" }).click();
    await expect(view(page).getByRole("button", { name: "Rendered" })).toHaveAttribute("aria-pressed", "true");
    await expect(view(page).locator(".frame img")).toHaveCSS("filter", "none");
    await expect.poll(async () => likeness(previewed, await frameCells(page)), { timeout: 10_000 }).toBeGreaterThan(0.9);
    await view(page).getByRole("button", { name: "Source" }).click();
    await expect(view(page).locator(".chips-note")).toHaveText("As shot · Preview shows the edits");
    await expect.poll(async () => view(page).locator(".frame").boundingBox().then((frame) => +(frame!.width / frame!.height).toFixed(2))).toBe(1.33);
  });

  await test.step("the user takes the turn off with its chip and ticks the mark off, and the agent reads both", async () => {
    await view(page).getByRole("button", { name: "Preview" }).click();
    await view(page).getByRole("button", { name: "Take off the turn" }).click();
    await expect(view(page).locator(".chip")).toHaveText(["Exposure +1.00 EV×", "Crop 161×121×"]);
    await expect.poll(async () => view(page).locator(".frame").boundingBox().then((frame) => +(frame!.width / frame!.height).toFixed(3))).toBe(+(161 / 121).toFixed(3));
    await expect(view(page).getByRole("button", { name: "Rendered (older)" })).toBeVisible();
    await view(page).getByLabel("m1 done").click();
    await expect(view(page).getByLabel("m1 done")).toBeChecked();
    await expect(view(page).locator(".marks li.done")).toHaveCount(1);
    const state = await mirador.callCanvasTool(host, conversation, "app_state", {});
    expect(state).toContain("Its frame is 161×121.");
    expect(state).toContain("- m1 box x 80, y 60, 160×120 px: sky too bright\non the left\nkeep the clouds (done)");
    expect(state).toContain("user: Turned back to as shot.");
  });

  await test.step("the pane is in Mirador's theme, and changes with it", async () => {
    const colours = () => view(page).locator("html").evaluate((element) => [getComputedStyle(element).backgroundColor, getComputedStyle(element).color]);
    await expect.poll(colours).toEqual(["rgb(255, 255, 255)", "rgb(26, 27, 32)"]);
    await mirador.chooseInSettings(page, "Theme", "Dark");
    await expect.poll(colours).toEqual(["rgb(18, 19, 23)", "rgb(228, 229, 233)"]);
  });
});
