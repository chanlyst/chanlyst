import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

// A product created in the browser has no id: the server makes one and returns
// it. For a while nothing read that answer back, and the consequence was not a
// visible error but a session that quietly stopped working — the browser held
// an id of "", so analyse, discover, the pipeline and the competitor gap all
// sent an empty product and were answered 400, and every save wrote another
// duplicate row because an empty id matches nothing to update. A reload fixed
// it, which is why it survived: it only ever broke the first run of a new
// product, for the person seeing the product for the first time.

test("the server answers a product save with the id it used", () => {
  const route = read("app/api/products/route.ts");
  assert.match(route, /const id = payload\.id \|\| crypto\.randomUUID\(\)/);
  assert.match(route, /Response\.json\(\{ persisted: true, id \}\)/);
});

test("the client reads that id back", () => {
  const client = read("app/dashboard/api-client.ts");
  const save = client.slice(client.indexOf("export async function saveProductApi"));
  const body = save.slice(0, save.indexOf("\n}\n"));
  assert.match(body, /id\?: string/, "the return type drops the id");
  assert.match(body, /return \{ ok: true, id: result\.id \}/, "the id is not returned");
});

test("and puts it on the product before anything else uses it", () => {
  const dashboard = read("app/dashboard/signalist-dashboard.tsx");
  const save = dashboard.slice(dashboard.indexOf("async function saveProduct("));
  const body = save.slice(0, save.indexOf("\n  }\n"));
  assert.match(body, /saved\.id/, "the saved id is ignored");
  const applied = body.indexOf("saved.id");
  const dispatched = body.indexOf('dispatch({ type: "productSaved"');
  assert.ok(applied < dispatched, "the id is applied after the product is stored");
});
