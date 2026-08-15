// Pure CSV helpers shared by API routes and unit tests.
// Kept as an .mjs module so tests/csv-helpers.test.mjs can import it
// directly with `node --test` while TypeScript routes import it via allowJs.

// Cells starting with these characters can execute as formulas when the CSV
// is opened in Excel or Google Sheets, so they are neutralized with a quote.
const FORMULA_PREFIX = /^[=+\-@]/;

// UTF-8 byte order mark: Excel needs it to detect Cyrillic text correctly.
const UTF8_BOM = "\uFEFF";

/**
 * Escape a single CSV cell: neutralize spreadsheet formula injection and
 * apply RFC 4180 quoting when the value contains separators or quotes.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeCsvCell(value) {
  let cell = String(value ?? "");
  if (FORMULA_PREFIX.test(cell)) cell = `'${cell}`;
  if (/[",\r\n]/.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

/**
 * Render rows of cells as a CSV document with CRLF line endings and a UTF-8
 * BOM so Excel opens Cyrillic content correctly.
 * @param {unknown[][]} rows
 * @returns {string}
 */
export function csvDocument(rows) {
  const body = rows
    .map((cells) => cells.map(escapeCsvCell).join(","))
    .join("\r\n");
  return `${UTF8_BOM}${body}\r\n`;
}

/**
 * Reduce a name to a safe ASCII slug usable inside a filename header.
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
export function slugifyAscii(value, fallback = "export") {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return slug || fallback;
}
