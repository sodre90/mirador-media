import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import ffmpeg from "ffmpeg-static";
import ffprobe from "@derhuerst/ffprobe-static";

const miradorDir = process.env.MIRADOR_DIR ?? join(import.meta.dirname, "..", "..", "visualized-claude-sessions");
const pluginDir = join(import.meta.dirname, "..");
const profileName = "media";

/** Mirador's test host and helpers, from its checkout: loaded in the hooks, as Playwright also imports this file in a process that never runs them. */
type Helpers = typeof import("../../visualized-claude-sessions/e2e/helpers.ts");
type TestHostModule = typeof import("../../visualized-claude-sessions/e2e/test-host.ts");
let mirador: Helpers;
let host: InstanceType<TestHostModule["TestHost"]>;

const prompts = () => readFileSync(join(host.root, "prompts"), "utf8");
const view = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-frame.app iframe");

/** A 45 second clip of ffmpeg's test pattern, long enough to mark the moment the acceptance names, 0:39. */
function testClip(path: string) {
  execFileSync(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x240:r=10:d=45", "-c:v", "libvpx", "-b:v", "300k", path]);
}

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

/** Drags across the picture between two points given as fractions of it, as the user draws a box. */
async function drawBox(page: Page, from: [number, number], to: [number, number]) {
  const video = view(page).locator("video");
  const picture = await video.evaluate((element: HTMLVideoElement) => {
    const bounds = element.getBoundingClientRect();
    const scale = Math.min(bounds.width / element.videoWidth, bounds.height / element.videoHeight);
    const [width, height] = [element.videoWidth * scale, element.videoHeight * scale];
    return { left: (bounds.width - width) / 2, top: (bounds.height - height) / 2, width, height };
  });
  const videoBox = (await video.boundingBox())!;
  const at = ([x, y]: [number, number]) => [videoBox.x + picture.left + picture.width * x, videoBox.y + picture.top + picture.height * y] as const;
  await page.mouse.move(...at(from));
  await page.mouse.down();
  await page.mouse.move(...at([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]));
  await page.mouse.move(...at(to));
  await page.mouse.up();
}

type RecordingWindow = Window & { shownFrames?: number[] };

/** Records the time of every frame the video shows from now on, for shownFrames to read. */
const recordShownFrames = (page: Page) =>
  view(page)
    .locator("video")
    .evaluate((element: HTMLVideoElement) => {
      const shown: number[] = ((window as RecordingWindow).shownFrames = []);
      const each = (_now: number, frame: { mediaTime: number }) => {
        shown.push(frame.mediaTime);
        element.requestVideoFrameCallback(each);
      };
      element.requestVideoFrameCallback(each);
    });

const shownFrames = (page: Page) => view(page).locator("video").evaluate(() => (window as RecordingWindow).shownFrames!);

test("mark 0:39 with a box and send 'too dark here'; the agent trims, cuts and brightens it, the pane previews that, and the render can be compared", async ({ page }) => {
  await mirador.signIn(page, host);
  await mirador.addWorkspace(page, host.projectDir);
  const profiles = await mirador.createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const conversation = await startConversation(page);
  await mirador.sendMessage(page, "Start");
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });

  await test.step("the agent opens the video in the app, which reads its size, length and frame rate", async () => {
    expect(await mirador.callCanvasTool(host, conversation, "app_open", { app: "media", file: "clip.media.json" })).toContain("No video yet.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "source", file: "clip.webm" } })).toBe("Opened clip.webm.");
    await expect(view(page).locator("header")).toContainText("clip.webm");
    await expect(view(page).locator(".facts")).toHaveText("320×240 · 10 fps · 0:45.00");
    expect(await mirador.callCanvasTool(host, conversation, "app_state", {})).toContain("Video: clip.webm, 320×240, 10 fps, 0:45.00, silent.");
  });

  await test.step("the user marks 0:39 with a box and sends what's wrong there, with the frame", async () => {
    await view(page).locator("video").evaluate((element: HTMLVideoElement) => void (element.currentTime = 39.05));
    await expect(view(page).getByLabel("Current time")).toHaveText("0:39.05 / 0:45.00");
    await drawBox(page, [0.25, 0.25], [0.75, 0.75]);
    await expect(view(page).locator(".composer .where")).toContainText("at 0:39.05 · frame 390 · box 160×120 px");
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

  await test.step("the agent trims, cuts and brightens it, and the pane previews all of it at once", async () => {
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "trim", start: 30, end: 42 } })).toBe("Trimmed to 0:30.00–0:42.00.");
    await expect(view(page).locator(".timeline .kept")).toHaveCount(1);
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "cut", start: 33, end: 35 } })).toBe("Cut 0:33.00–0:35.00 out.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "exposure", ev: 1 } })).toBe("Set the exposure to +1.00 EV.");
    expect(await mirador.callCanvasTool(host, conversation, "apply", { op: { op: "mark-done", mark: "m1" } })).toBe("Marked m1 done.");
    await expect(view(page).locator(".edits")).toHaveText("Edits: trim 0:30.00–0:42.00; cut 0:33.00–0:35.00; exposure +1.00 EV");
    expect(await mirador.callCanvasTool(host, conversation, "app_state", {})).toContain("The result is 0:10.00 long, in 2 pieces.");
    await expect(view(page).locator("video")).toHaveCSS("filter", "brightness(2)");
    await expect(view(page).locator(".timeline .kept")).toHaveCount(2);
    await expect(view(page).getByLabel("m1 done")).toBeChecked();

    await view(page).locator("video").evaluate((element: HTMLVideoElement) => void (element.currentTime = 32.5));
    await expect(view(page).getByLabel("Current time")).toHaveText("0:32.50 / 0:45.00");
    await recordShownFrames(page);
    await view(page).getByRole("button", { name: "Play" }).click();
    await expect(view(page).getByLabel("Current time")).toHaveText("0:42.00 / 0:45.00", { timeout: 15_000 });
    await expect(view(page).getByRole("button", { name: "Play" })).toBeVisible();
    const times = await shownFrames(page);
    expect(times.filter((time) => time > 33.15 && time < 34.95)).toEqual([]);
    expect(times.some((time) => time > 32.5 && time < 33)).toBe(true);
    expect(times.some((time) => time >= 35 && time < 36)).toBe(true);
  });

  await test.step("the agent renders, and the user compares the rendered file with the source", async () => {
    expect(await mirador.callCanvasTool(host, conversation, "app_run", { task: "render" })).toMatch(
      /^Rendered clip\.edited\.webm \(edits: trim 0:30\.00–0:42\.00; cut 0:33\.00–0:35\.00; exposure \+1\.00 EV\) in \d+ s; the user can compare it with clip\.webm in the app\.$/,
    );
    const rendered = join(host.projectDir, "clip.edited.webm");
    expect(existsSync(rendered)).toBe(true);
    expect(durationOf(rendered)).toBeCloseTo(10, 0);
    await view(page).locator("video").evaluate((element: HTMLVideoElement) => void (element.currentTime = 36));
    await view(page).getByRole("button", { name: "Rendered" }).click();
    await expect(view(page).getByLabel("Current time")).toHaveText(/^0:04\.00 \/ 0:10\.\d\d$/);
    await expect(view(page).locator("video")).toHaveCSS("filter", "none");
    await view(page).getByRole("button", { name: "Source" }).click();
    await expect(view(page).getByLabel("Current time")).toHaveText("0:36.00 / 0:45.00");
    await expect(view(page).locator(".edits")).toHaveText("As shot. Edits: trim 0:30.00–0:42.00; cut 0:33.00–0:35.00; exposure +1.00 EV (Preview shows them)");
  });
});
