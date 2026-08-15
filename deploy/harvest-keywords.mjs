// Harvests Google's own autocomplete for a set of seeds, expanded by letter and
// by question word. Autocomplete is the only free source of real user phrasing:
// every suggestion is a query people actually typed, which is exactly what a
// long-tail list needs and what invented keyword lists never have.

import { writeFileSync } from "node:fs";

const SEEDS = [
  "where to promote my saas",
  "how to promote a saas product",
  "saas directories",
  "where to submit my startup",
  "startup directories to submit",
  "how to get first customers saas",
  "product hunt alternatives",
  "b2b saas distribution channels",
  "customer acquisition channels for saas",
  "how to find where my customers are online",
  "saas marketing channels",
  "list of places to submit your app",
  "how to promote a b2b tool",
  "free directories to list your startup",
  "where to post about my product launch",
  "saas launch checklist",
  "how to do cold outreach for saas",
  "how to find niche communities for my product",
  "where to advertise a developer tool",
  "channel research tool",
];

const MODIFIERS = [
  "", " a", " b", " c", " d", " e", " f", " g", " h", " i", " j", " k", " l",
  " m", " n", " o", " p", " q", " r", " s", " t", " u", " v", " w", " x", " y",
  " z", " 2026", " free", " best", " list", " for", " reddit", " tool", " b2b",
];

const QUESTIONS = ["how", "what", "where", "why", "which", "who", "when", "is", "can", "should"];

async function suggest(query) {
  const url =
    "https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=us&q=" +
    encodeURIComponent(query);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });
    if (!response.ok) return [];
    const [, list] = await response.json();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const found = new Map();
const queue = [];
for (const seed of SEEDS) {
  for (const modifier of MODIFIERS) queue.push(seed + modifier);
  for (const question of QUESTIONS) queue.push(`${question} ${seed}`);
}

// Sequential with a small pause: the endpoint is public and ungated, and
// hammering it is both rude and the fastest way to start getting empty answers.
let done = 0;
for (const query of queue) {
  for (const hit of await suggest(query)) {
    found.set(hit.toLowerCase(), (found.get(hit.toLowerCase()) || 0) + 1);
  }
  done += 1;
  if (done % 100 === 0) console.error(`${done}/${queue.length} — ${found.size} phrases`);
  await new Promise((resolve) => setTimeout(resolve, 120));
}

const rows = [...found.entries()]
  .map(([phrase, hits]) => ({ phrase, hits }))
  .sort((a, b) => b.hits - a.hits || a.phrase.localeCompare(b.phrase));

writeFileSync("suggestions.json", JSON.stringify(rows, null, 2));
console.error(`\n${rows.length} unique phrases written to suggestions.json`);
