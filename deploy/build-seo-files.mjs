// Regenerates public/robots.txt and public/sitemap.xml from app/lib/public-routes.mjs.
// Run after adding or removing a public page; the test suite fails until you do.
import { writeFileSync } from "node:fs";
import { buildRobots, buildSitemap } from "../app/lib/public-routes.mjs";

const lastmod = process.argv[2] || new Date().toISOString().slice(0, 10);
writeFileSync("public/robots.txt", buildRobots());
writeFileSync("public/sitemap.xml", buildSitemap(lastmod));
console.log(`robots.txt и sitemap.xml обновлены (lastmod ${lastmod})`);
