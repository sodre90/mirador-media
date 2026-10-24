import type { Span } from "./document.ts";

/**
 * The ranges with `span` painted over them, as a brush paints: what they had there gives way to `replacement`, or to
 * nothing when it is null, and the parts outside it stay. Neighbours that touch and are alike join into one.
 */
export function painted<Range extends Span>(ranges: Range[], span: Span, replacement: Range | null, alike: (a: Range, b: Range) => boolean): Range[] {
  const outside = ranges.flatMap((range) => [
    ...(range.start < span.start ? [{ ...range, end: Math.min(range.end, span.start) }] : []),
    ...(range.end > span.end ? [{ ...range, start: Math.max(range.start, span.end) }] : []),
  ]);
  const sorted = [...outside, ...(replacement ? [replacement] : [])].sort((a, b) => a.start - b.start);
  return sorted.reduce<Range[]>((joined, range) => {
    const previous = joined.at(-1);
    if (previous && previous.end >= range.start && alike(previous, range)) return [...joined.slice(0, -1), { ...previous, end: Math.max(previous.end, range.end) }];
    return [...joined, range];
  }, []);
}

/** The spans with `span` added, joined with those it touches. */
export const withSpan = (spans: Span[], span: Span) => painted(spans, span, { start: span.start, end: span.end }, () => true);

/** The spans with `span` taken out of them. */
export const withoutSpan = (spans: Span[], span: Span) => painted(spans, span, null, () => true);

/** The parts of `within` that none of `taken` covers, in order. */
export const remainingOf = (within: Span, taken: Span[]) =>
  taken.reduce<Span[]>((remaining, cut) => withoutSpan(remaining, cut), [{ start: within.start, end: within.end }]).filter(({ start, end }) => end > start);

export const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
