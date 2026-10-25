// Downloads the pinned ffmpeg and ffprobe for this machine at install, checks them against their pinned sha256 and
// unpacks them where host/ffmpeg.ts looks for them.
import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { unzipSync } from "fflate";
import { buildForThisMachine, downloadUrl, FFMPEG_VERSION, programFolder, programPath, programs, thisMachine } from "../host/ffmpeg-build.ts";

const build = buildForThisMachine();
if (!build) {
  console.warn(`mirador-media: no ffmpeg ${FFMPEG_VERSION} build for ${thisMachine}; renders and probes won't work here`);
  process.exit(0);
}

mkdirSync(programFolder, { recursive: true });
for (const program of programs.filter((each) => !existsSync(programPath(each)))) {
  const url = downloadUrl(build, program);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`downloading ${url} failed: ${response.status}`);
  const zip = new Uint8Array(await response.arrayBuffer());
  const sha256 = new Bun.CryptoHasher("sha256").update(zip).digest("hex");
  if (sha256 !== build.sha256[program]) throw new Error(`${url} isn't the pinned build: its sha256 is ${sha256}`);
  const binary = unzipSync(zip, { filter: (file) => file.name === program })[program];
  if (!binary) throw new Error(`${url} has no ${program} in it`);
  const partial = `${programPath(program)}.partial`;
  await Bun.write(partial, binary);
  chmodSync(partial, 0o755);
  renameSync(partial, programPath(program));
  console.log(`mirador-media: ${program} ${FFMPEG_VERSION} installed`);
}
