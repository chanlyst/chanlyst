import { readFile } from "node:fs/promises";

const baseUrl = process.env.CHANLYST_IMPORT_URL || "http://127.0.0.1:3000";
const migrationDir = process.env.CHANLYST_MIGRATION_DIR || "/opt/chanlyst/migration";

async function json(name) {
  return JSON.parse(await readFile(`${migrationDir}/${name}`, "utf8"));
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const productExport = await json("chanlyst-products.json");
const prospectExport = await json("chanlyst-prospects.json");
const messageExport = await json("chanlyst-messages.json");

for (const product of productExport.products || []) {
  await post("/api/products", product);
}

const productId = productExport.products?.[0]?.id;
if (productId && prospectExport.prospects?.length) {
  await post("/api/prospects", {
    productId,
    prospects: prospectExport.prospects,
  });
}

for (const message of messageExport.messages || []) {
  await post("/api/messages", message);
}

console.log(
  JSON.stringify({
    products: productExport.products?.length || 0,
    prospects: prospectExport.prospects?.length || 0,
    messages: messageExport.messages?.length || 0,
  }),
);
