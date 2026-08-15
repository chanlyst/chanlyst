import assert from "node:assert/strict";
import test from "node:test";
import {
  csvDocument,
  escapeCsvCell,
  slugifyAscii,
} from "../app/lib/csv.mjs";

test("escapeCsvCell applies RFC 4180 quoting", () => {
  assert.equal(escapeCsvCell("plain"), "plain");
  assert.equal(escapeCsvCell("a,b"), '"a,b"');
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(escapeCsvCell("line\r\nbreak"), '"line\r\nbreak"');
  assert.equal(escapeCsvCell(""), "");
  assert.equal(escapeCsvCell(null), "");
  assert.equal(escapeCsvCell(undefined), "");
  assert.equal(escapeCsvCell(42), "42");
});

test("escapeCsvCell neutralizes spreadsheet formula injection", () => {
  assert.equal(escapeCsvCell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
  assert.equal(escapeCsvCell("+1234567"), "'+1234567");
  assert.equal(escapeCsvCell("-cmd"), "'-cmd");
  assert.equal(escapeCsvCell("@import"), "'@import");
  // Injection prefix combined with a separator still gets quoted.
  assert.equal(escapeCsvCell('=HYPERLINK("x"),y'), '"\'=HYPERLINK(""x""),y"');
  // Regular text starting with letters is untouched.
  assert.equal(escapeCsvCell("email@example.com"), "email@example.com");
  assert.equal(escapeCsvCell("Привет"), "Привет");
});

test("csvDocument starts with a UTF-8 BOM and uses CRLF line endings", () => {
  const csv = csvDocument([
    ["company", "score"],
    ["Пример, ООО", 90],
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.equal(csv, '\uFEFFcompany,score\r\n"Пример, ООО",90\r\n');
});

test("slugifyAscii produces safe ASCII filenames", () => {
  assert.equal(slugifyAscii("Café Product X"), "cafe-product-x");
  assert.equal(slugifyAscii("Мой продукт", "prospects"), "prospects");
  assert.equal(slugifyAscii("  spaced   name  "), "spaced-name");
  assert.equal(slugifyAscii("", "prospects"), "prospects");
  assert.equal(slugifyAscii("a".repeat(120)).length, 60);
});
