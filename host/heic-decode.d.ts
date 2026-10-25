declare module "heic-decode" {
  /** The first picture of a HEIC or HEIF file, turned as it is stored to be shown, as RGBA. */
  export default function decode(input: { buffer: Uint8Array }): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}
