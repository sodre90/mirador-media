/** The CSS filter that previews an exposure, the way the render applies it. */
export const exposurePreview = (ev: number) => (ev === 0 ? "none" : `brightness(${2 ** ev})`);
