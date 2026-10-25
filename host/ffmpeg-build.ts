import { join } from "node:path";

export const FFMPEG_VERSION = "9.0.2";

type Program = "ffmpeg" | "ffprobe";

interface Build {
  folder: string;
  sha256: Record<Program, string>;
}

/** martin-riedl.de's static release builds, the same version on every machine. They are configured with --enable-nonfree, so each install downloads them and this repository never ships them. */
const builds: Record<string, Build> = {
  "darwin-arm64": {
    folder: "macos/arm64/1789931890_9.0.2",
    sha256: { ffmpeg: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924", ffprobe: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6" },
  },
  "darwin-x64": {
    folder: "macos/amd64/1789931006_9.0.2",
    sha256: { ffmpeg: "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4", ffprobe: "2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd" },
  },
  "linux-x64": {
    folder: "linux/amd64/1789931100_9.0.2",
    sha256: { ffmpeg: "fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f", ffprobe: "3f428c49070be3d24ec338602b76d412e401ffcb8a5641ef0e729181a232fc32" },
  },
  "linux-arm64": {
    folder: "linux/arm64/1789931697_9.0.2",
    sha256: { ffmpeg: "93a76ae90db5474eecdf951a729857c64f3de23567228d6a7d5e6e8e3cd1021b", ffprobe: "bcbe80fb741c180083327afaf5434812e006b33cacde2016b9aeaf6936128330" },
  },
};

export const programs: Program[] = ["ffmpeg", "ffprobe"];

export const thisMachine = `${process.platform}-${process.arch}`;

export const buildForThisMachine = (): Build | undefined => builds[thisMachine];

export const downloadUrl = (build: Build, program: Program) => `https://ffmpeg.martin-riedl.de/download/${build.folder}/${program}.zip`;

/** Inside node_modules, so a reinstall from scratch fetches them again and a copy of the plugin that links node_modules finds them. */
export const programFolder = join(import.meta.dirname, "..", "node_modules", ".cache", "mirador-media", `ffmpeg-${FFMPEG_VERSION}`);

export const programPath = (program: Program) => join(programFolder, program);
