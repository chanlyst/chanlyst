// The Chanlyst mark: a doorway on a sign board.
//
// It replaces the open ring in a lime tile. The ring read as a "C" and as an
// unclosed channel, which was true but generic — the same mark would have
// suited any product whose name starts with C. This one says what the product
// is for: an opening you can walk through, on the board a place hangs outside
// itself. The same shape repeats through the interface as the coloured sign on
// every channel, so the logo and the smallest component in the product are the
// one idea.
//
// Drawn as geometry rather than a letterform on purpose: it has to survive as a
// 16px favicon and inside a Gumroad page, and SVG text depends on a font being
// installed where the mark is finally rendered.

/** The arch: a doorway standing on the base of the board. */
const DOORWAY = "M20 53 V32 A12 12 0 0 1 44 32 V53 Z";

export type BrandMarkProps = {
  /** Rendered size in px. The art is scale-free; this only sets the box. */
  size?: number;
  /** Board colour. Transparent drops the board and outlines the doorway. */
  tile?: string;
  /** The doorway itself. */
  ring?: string;
  className?: string;
};

export function BrandMark({
  size = 42,
  tile = "#0f7a55",
  ring = "#ffffff",
  className,
}: BrandMarkProps) {
  const bare = tile === "transparent";

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Chanlyst"
      xmlns="http://www.w3.org/2000/svg"
    >
      {!bare && <rect width="64" height="64" rx="18" fill={tile} />}
      {/* Without a board the doorway would read as a solid blob, so it is
          outlined instead of filled. */}
      <path
        d={DOORWAY}
        fill={bare ? "none" : ring}
        stroke={bare ? ring : "none"}
        strokeWidth={bare ? 6 : 0}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The same mark as a standalone SVG file, for the favicon and anywhere React
 * cannot reach (Gumroad pages, e-mail, covers).
 *
 * @param {{tile?: string, ring?: string}} options
 * @returns {string}
 */
export function brandMarkSvg({ tile = "#0f7a55", ring = "#ffffff" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">\
<rect width="64" height="64" rx="18" fill="${tile}"/>\
<path d="${DOORWAY}" fill="${ring}"/>\
</svg>`;
}
