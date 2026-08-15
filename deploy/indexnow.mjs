// Tells the search engines that participate in IndexNow which pages exist.
//
// Search Console needs a Google account and cannot be automated from here.
// IndexNow needs neither: a key file at the domain root is the whole
// authentication, and one POST covers Bing, Yandex, Seznam and Naver at once.
// Google does not participate, so this is not a substitute for Search Console
// — it is the half of the problem that does not depend on anybody logging in.
//
// The URLs come from the sitemap rather than a list typed here, so a page that
// is in one is in the other by construction.
//
// Usage: node deploy/indexnow.mjs [--dry]

import { readFileSync, readdirSync } from "node:fs";

const HOST = "chanlyst.com";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const dry = process.argv.includes("--dry");

/** The key is the name of the file that proves we own the host. */
function readKey() {
  const file = readdirSync("public").find((name) => /^[0-9a-f]{32}\.txt$/.test(name));
  if (!file) throw new Error("no IndexNow key file in public/");

  const key = file.replace(/\.txt$/, "");
  const contents = readFileSync(`public/${file}`, "utf8").trim();
  if (contents !== key) {
    throw new Error(`public/${file} must contain exactly its own name`);
  }
  return key;
}

function sitemapUrls() {
  const xml = readFileSync("public/sitemap.xml", "utf8");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  if (!urls.length) throw new Error("the sitemap lists nothing");

  // Submitting a URL on another host is how a key gets rejected for everything.
  const foreign = urls.filter((url) => new URL(url).host !== HOST);
  if (foreign.length) throw new Error(`sitemap points off-host: ${foreign[0]}`);
  return urls;
}

const key = readKey();
const urlList = sitemapUrls();

console.log(`${urlList.length} URLs, key ${key.slice(0, 8)}…`);
for (const url of urlList) console.log(`  ${url}`);

if (dry) {
  console.log("\n--dry: nothing was sent.");
  process.exit(0);
}

const response = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: HOST,
    key,
    keyLocation: `https://${HOST}/${key}.txt`,
    urlList,
  }),
});

// 200 accepted, 202 accepted but the key is still being checked. Anything else
// is worth reading rather than retrying: 403 means the key file is not
// reachable, 422 that a URL does not belong to the host.
console.log(`\n${response.status} ${response.statusText}`);
const body = await response.text();
if (body) console.log(body.slice(0, 400));
process.exit(response.ok ? 0 : 1);
