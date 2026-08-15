import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// The favicon is the mark at 16px, and it lives in a file separate from the
// component that draws it — which is exactly how the two drift apart. The old
// ring survived in public/favicon.svg for as long as nobody looked.
test("the favicon is the same mark the component draws", () => {
  const component = readFileSync("app/components/brand-mark.tsx", "utf8");
  const favicon = readFileSync("public/favicon.svg", "utf8");
  const doorway = /const DOORWAY = "([^"]+)"/.exec(component)?.[1];

  assert.ok(doorway, "the component no longer defines a doorway path");
  assert.ok(favicon.includes(doorway), "public/favicon.svg is drawing the old mark");
});

// The mark has to survive without its board — the sign-in and invite screens
// drop it — and a filled doorway on no background is an unreadable blob.
test("without a board the doorway is outlined, not filled", () => {
  const component = readFileSync("app/components/brand-mark.tsx", "utf8");

  assert.ok(component.includes('const bare = tile === "transparent"'));
  assert.ok(component.includes('fill={bare ? "none" : ring}'));
  assert.ok(component.includes('stroke={bare ? ring : "none"}'));
});
