// Regenerates public/robots.txt, public/sitemap.xml and public/llms.txt from app/lib/public-routes.mjs.
// Run after adding or removing a public page; the test suite fails until you do.
import { writeFileSync } from "node:fs";
import { buildLlms, buildRobots, buildSitemap } from "../app/lib/public-routes.mjs";

const lastmod = process.argv[2] || new Date().toISOString().slice(0, 10);
writeFileSync("public/robots.txt", buildRobots());
writeFileSync("public/sitemap.xml", buildSitemap(lastmod));
writeFileSync("public/llms.txt", buildLlms());
console.log(`robots.txt, sitemap.xml и llms.txt обновлены (lastmod ${lastmod})`);
