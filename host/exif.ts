/**
 * A photo's EXIF, as the TIFF block that JPEG, PNG, WebP and HEIF each wrap their own way: read from the photo, made
 * right for its render and written into it. ffmpeg writes none into a JPEG or WebP, so the render would lose when and
 * where the photo was taken, and the camera.
 */

const ascii = (text: string) => new TextEncoder().encode(text);
const fourCC = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
const startsWith = (bytes: Uint8Array, prefix: Uint8Array, at = 0) => prefix.every((byte, index) => bytes[at + index] === byte);
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const joined = (...parts: Uint8Array[]) => {
  const whole = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  parts.reduce((at, part) => (whole.set(part, at), at + part.length), 0);
  return whole;
};

const JPEG_START = Uint8Array.of(0xff, 0xd8);
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const EXIF_HEADER = ascii("Exif\0\0");
const JPEG_SEGMENT_MOST = 0xffff - 2;

const ORIENTATION = 0x0112;
const MAKE = 0x010f;
const MODEL = 0x0110;
const EXIF_IFD = 0x8769;
const GPS_IFD = 0x8825;
const TAKEN = 0x9003;
const PIXEL_WIDTH = 0xa002;
const PIXEL_HEIGHT = 0xa003;
const SHORT = 3;
const LONG = 4;

/** The photo's EXIF, or null when it has none or its format isn't one of these. */
export function exifOf(photo: Uint8Array): Uint8Array | null {
  if (startsWith(photo, JPEG_START)) return jpegExif(photo);
  if (startsWith(photo, PNG_SIGNATURE)) return pngChunks(photo).find(({ type }) => type === "eXIf")?.data ?? null;
  if (fourCC(photo, 0) === "RIFF" && fourCC(photo, 8) === "WEBP") {
    const data = riffChunks(photo).find(({ type }) => type === "EXIF")?.data ?? null;
    return data && startsWith(data, EXIF_HEADER) ? data.subarray(EXIF_HEADER.length) : data;
  }
  if (fourCC(photo, 4) === "ftyp") return heifExif(photo);
  return null;
}

/** The render with the EXIF in it, in place of any it had; a JPEG whose EXIF can't fit one segment stays without. */
export function withExif(render: Uint8Array, exif: Uint8Array): Uint8Array {
  if (startsWith(render, JPEG_START)) return withJpegExif(render, exif);
  if (startsWith(render, PNG_SIGNATURE)) return withPngExif(render, exif);
  if (fourCC(render, 0) === "RIFF" && fourCC(render, 8) === "WEBP") return withWebpExif(render, exif);
  return render;
}

/**
 * The photo's EXIF made right for a render of it: upright, as renders are, its size the render's, and without the
 * thumbnail, which still shows the photo unedited.
 */
export function exifForRender(exif: Uint8Array, size: { width: number; height: number }): Uint8Array | null {
  const tiff = Tiff.of(exif.slice());
  if (!tiff) return null;
  tiff.set(tiff.firstIfd, ORIENTATION, 1);
  tiff.endAfterFirstIfd();
  const exifIfd = tiff.pointer(tiff.firstIfd, EXIF_IFD);
  if (exifIfd !== null) {
    tiff.set(exifIfd, PIXEL_WIDTH, size.width);
    tiff.set(exifIfd, PIXEL_HEIGHT, size.height);
  }
  return tiff.bytes;
}

/** What the EXIF says about the photo, for tests and descriptions. */
export function exifFacts(exif: Uint8Array) {
  const tiff = Tiff.of(exif);
  if (!tiff) return null;
  const exifIfd = tiff.pointer(tiff.firstIfd, EXIF_IFD);
  return {
    orientation: tiff.number(tiff.firstIfd, ORIENTATION),
    make: tiff.text(tiff.firstIfd, MAKE),
    model: tiff.text(tiff.firstIfd, MODEL),
    taken: exifIfd === null ? null : tiff.text(exifIfd, TAKEN),
    size: exifIfd === null ? null : { width: tiff.number(exifIfd, PIXEL_WIDTH), height: tiff.number(exifIfd, PIXEL_HEIGHT) },
    hasPlace: tiff.pointer(tiff.firstIfd, GPS_IFD) !== null,
    hasThumbnail: tiff.nextIfd(tiff.firstIfd) !== 0,
  };
}

interface Entry {
  tag: number;
  type: number;
  count: number;
  at: number;
}

class Tiff {
  private constructor(
    readonly bytes: Uint8Array,
    private readonly data: DataView,
    private readonly little: boolean,
    readonly firstIfd: number,
  ) {}

  static of(bytes: Uint8Array) {
    if (bytes.length < 8) return null;
    const order = fourCC(bytes, 0).slice(0, 2);
    if (order !== "II" && order !== "MM") return null;
    const data = view(bytes);
    const little = order === "II";
    const firstIfd = data.getUint32(4, little);
    return firstIfd + 2 <= bytes.length ? new Tiff(bytes, data, little, firstIfd) : null;
  }

  private entries(ifd: number): Entry[] {
    if (ifd + 2 > this.bytes.length) return [];
    const count = this.data.getUint16(ifd, this.little);
    return Array.from({ length: count }, (_, index) => ifd + 2 + index * 12)
      .filter((at) => at + 12 <= this.bytes.length)
      .map((at) => ({ tag: this.data.getUint16(at, this.little), type: this.data.getUint16(at + 2, this.little), count: this.data.getUint32(at + 4, this.little), at }));
  }

  private entry(ifd: number, tag: number) {
    return this.entries(ifd).find((entry) => entry.tag === tag);
  }

  private nextIfdAt(ifd: number) {
    return ifd + 2 + this.data.getUint16(ifd, this.little) * 12;
  }

  nextIfd(ifd: number) {
    const at = this.nextIfdAt(ifd);
    return at + 4 <= this.bytes.length ? this.data.getUint32(at, this.little) : 0;
  }

  endAfterFirstIfd() {
    const at = this.nextIfdAt(this.firstIfd);
    if (at + 4 <= this.bytes.length) this.data.setUint32(at, 0, this.little);
  }

  number(ifd: number, tag: number) {
    const entry = this.entry(ifd, tag);
    if (!entry || entry.count !== 1) return null;
    if (entry.type === SHORT) return this.data.getUint16(entry.at + 8, this.little);
    if (entry.type === LONG) return this.data.getUint32(entry.at + 8, this.little);
    return null;
  }

  pointer(ifd: number, tag: number) {
    const offset = this.number(ifd, tag);
    return offset !== null && offset + 2 <= this.bytes.length ? offset : null;
  }

  text(ifd: number, tag: number) {
    const entry = this.entry(ifd, tag);
    if (!entry) return null;
    const start = entry.count <= 4 ? entry.at + 8 : this.data.getUint32(entry.at + 8, this.little);
    const text = new TextDecoder().decode(this.bytes.subarray(start, start + entry.count));
    return text.replace(/\0+$/, "");
  }

  /** A number the IFD already has, changed in place: the block keeps its layout, so every offset in it stays right. */
  set(ifd: number, tag: number, value: number) {
    const entry = this.entry(ifd, tag);
    if (!entry || entry.count !== 1) return;
    if (entry.type === SHORT) this.data.setUint16(entry.at + 8, value, this.little);
    if (entry.type === LONG) this.data.setUint32(entry.at + 8, value, this.little);
  }
}

function jpegExif(photo: Uint8Array) {
  const exifSegment = jpegSegments(photo).segments.find(isExifSegment);
  return exifSegment ? exifSegment.subarray(4 + EXIF_HEADER.length) : null;
}

function jpegSegments(jpeg: Uint8Array) {
  const data = view(jpeg);
  const segments: Uint8Array[] = [];
  let at = 2;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff && jpeg[at + 1] !== 0xda) {
    const length = data.getUint16(at + 2);
    segments.push(jpeg.subarray(at, at + 2 + length));
    at += 2 + length;
  }
  return { segments, rest: jpeg.subarray(at) };
}

const isExifSegment = (segment: Uint8Array) => segment[1] === 0xe1 && startsWith(segment, EXIF_HEADER, 4);
const isJfifSegment = (segment: Uint8Array) => segment[1] === 0xe0;

/** EXIF goes first, or right after a JFIF header, which has to be first itself. */
function withJpegExif(render: Uint8Array, exif: Uint8Array) {
  const payload = joined(EXIF_HEADER, exif);
  if (payload.length > JPEG_SEGMENT_MOST) return render;
  const { segments, rest } = jpegSegments(render);
  const kept = segments.filter((segment) => !isExifSegment(segment));
  const exifSegment = joined(Uint8Array.of(0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff), payload);
  kept.splice(kept[0] && isJfifSegment(kept[0]) ? 1 : 0, 0, exifSegment);
  return joined(JPEG_START, ...kept, rest);
}

interface Chunk {
  type: string;
  data: Uint8Array;
  whole: Uint8Array;
}

function pngChunks(png: Uint8Array): Chunk[] {
  const data = view(png);
  const chunks: Chunk[] = [];
  for (let at = PNG_SIGNATURE.length; at + 12 <= png.length; ) {
    const length = data.getUint32(at);
    chunks.push({ type: fourCC(png, at + 4), data: png.subarray(at + 8, at + 8 + length), whole: png.subarray(at, at + 12 + length) });
    at += 12 + length;
  }
  return chunks;
}

function pngChunk(type: string, content: Uint8Array) {
  const chunk = new Uint8Array(12 + content.length);
  const data = view(chunk);
  data.setUint32(0, content.length);
  chunk.set(ascii(type), 4);
  chunk.set(content, 8);
  data.setUint32(8 + content.length, Bun.hash.crc32(chunk.subarray(4, 8 + content.length)));
  return chunk;
}

/** eXIf goes before the picture's data, where a reader that stops there still finds it. */
function withPngExif(render: Uint8Array, exif: Uint8Array) {
  const chunks = pngChunks(render).filter(({ type }) => type !== "eXIf");
  const firstData = chunks.findIndex(({ type }) => type === "IDAT");
  const wholes = chunks.map(({ whole }) => whole);
  wholes.splice(firstData < 0 ? wholes.length - 1 : firstData, 0, pngChunk("eXIf", exif));
  return joined(PNG_SIGNATURE, ...wholes);
}

function riffChunks(webp: Uint8Array): Chunk[] {
  const data = view(webp);
  const chunks: Chunk[] = [];
  for (let at = 12; at + 8 <= webp.length; ) {
    const length = data.getUint32(at + 4, true);
    const padded = length + (length % 2);
    chunks.push({ type: fourCC(webp, at), data: webp.subarray(at + 8, at + 8 + length), whole: webp.subarray(at, at + 8 + padded) });
    at += 8 + padded;
  }
  return chunks;
}

function riffChunk(type: string, content: Uint8Array) {
  const chunk = new Uint8Array(8 + content.length + (content.length % 2));
  chunk.set(ascii(type), 0);
  view(chunk).setUint32(4, content.length, true);
  chunk.set(content, 8);
  return chunk;
}

const VP8X_HAS_EXIF = 0x08;
const VP8X_HAS_ALPHA = 0x10;

/** A simple WebP's canvas, which an extended one's VP8X header has to state. */
function canvasOf(picture: Chunk) {
  const data = view(picture.data);
  if (picture.type === "VP8 ") return { width: data.getUint16(6, true) & 0x3fff, height: data.getUint16(8, true) & 0x3fff, alpha: false };
  const bits = data.getUint32(1, true);
  return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, alpha: ((bits >> 28) & 1) === 1 };
}

function vp8x({ width, height, alpha }: { width: number; height: number; alpha: boolean }) {
  const header = new Uint8Array(10);
  header[0] = VP8X_HAS_EXIF | (alpha ? VP8X_HAS_ALPHA : 0);
  [width - 1, height - 1].forEach((value, index) => header.set([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff], 4 + index * 3));
  return riffChunk("VP8X", header);
}

/** An extended WebP takes EXIF as a chunk after the picture and says so in its VP8X header; a simple one becomes extended. */
function withWebpExif(render: Uint8Array, exif: Uint8Array) {
  const chunks = riffChunks(render).filter(({ type }) => type !== "EXIF");
  const [first] = chunks;
  if (!first) return render;
  const wholes = chunks.map(({ whole }) => whole);
  if (first.type === "VP8X") {
    const header = first.whole.slice();
    header[8]! |= VP8X_HAS_EXIF;
    wholes[0] = header;
  } else wholes.unshift(vp8x(canvasOf(first)));
  const body = joined(ascii("WEBP"), ...wholes, riffChunk("EXIF", exif));
  const size = new Uint8Array(4);
  view(size).setUint32(0, body.length, true);
  return joined(ascii("RIFF"), size, body);
}

interface Box {
  type: string;
  content: Uint8Array;
}

function boxes(bytes: Uint8Array): Box[] {
  const data = view(bytes);
  const found: Box[] = [];
  for (let at = 0; at + 8 <= bytes.length; ) {
    const size = data.getUint32(at);
    const length = size === 0 ? bytes.length - at : size;
    if (length < 8 || at + length > bytes.length) break;
    found.push({ type: fourCC(bytes, at + 4), content: bytes.subarray(at + 8, at + length) });
    at += length;
  }
  return found;
}

const sized = (data: DataView, at: number, bytes: number) => (bytes === 0 ? 0 : bytes === 4 ? data.getUint32(at) : bytes === 8 ? Number(data.getBigUint64(at)) : data.getUint16(at));

/** The Exif item's ID, from the item info box of HEIF's meta box. */
function exifItemId(iinf: Uint8Array) {
  const version = iinf[0]!;
  const entries = boxes(iinf.subarray(version === 0 ? 6 : 8)).filter(({ type }) => type === "infe");
  for (const { content } of entries) {
    const data = view(content);
    const infeVersion = content[0]!;
    if (infeVersion < 2) continue;
    const idBytes = infeVersion === 2 ? 2 : 4;
    if (fourCC(content, 4 + idBytes + 2) === "Exif") return sized(data, 4, idBytes);
  }
  return null;
}

/** Where an item's data is in the file, from the item location box; only items in one extent of the file itself. */
function itemPlace(iloc: Uint8Array, itemId: number) {
  const data = view(iloc);
  const version = iloc[0]!;
  const [offsetSize, lengthSize, baseSize, indexSize] = [iloc[4]! >> 4, iloc[4]! & 15, iloc[5]! >> 4, version > 0 ? iloc[5]! & 15 : 0];
  const idBytes = version < 2 ? 2 : 4;
  let at = 6;
  const itemCount = sized(data, at, idBytes);
  at += idBytes;
  for (let item = 0; item < itemCount; item++) {
    const id = sized(data, at, idBytes);
    at += idBytes;
    const construction = version > 0 ? data.getUint16(at) & 15 : 0;
    at += (version > 0 ? 2 : 0) + 2;
    const base = sized(data, at, baseSize);
    at += baseSize;
    const extents = data.getUint16(at);
    at += 2;
    const places = Array.from({ length: extents }, () => {
      at += indexSize;
      const offset = sized(data, at, offsetSize);
      at += offsetSize;
      const length = sized(data, at, lengthSize);
      at += lengthSize;
      return { offset: base + offset, length };
    });
    if (id === itemId) return construction === 0 && places.length === 1 ? places[0]! : null;
  }
  return null;
}

/** HEIF keeps EXIF as an item: four bytes saying how far in the TIFF block starts, then the block. */
function heifExif(photo: Uint8Array) {
  const meta = boxes(photo).find(({ type }) => type === "meta");
  if (!meta) return null;
  const inMeta = boxes(meta.content.subarray(4));
  const iinf = inMeta.find(({ type }) => type === "iinf");
  const iloc = inMeta.find(({ type }) => type === "iloc");
  const itemId = iinf && exifItemId(iinf.content);
  const place = iloc && itemId != null ? itemPlace(iloc.content, itemId) : null;
  if (!place || place.offset + place.length > photo.length || place.length < 4) return null;
  const item = photo.subarray(place.offset, place.offset + place.length);
  const tiffStart = 4 + view(item).getUint32(0);
  return tiffStart < item.length ? item.subarray(tiffStart) : null;
}
