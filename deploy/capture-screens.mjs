// Снимает экраны приложения в public/tour/ для онбординг-тура.
//
// Зачем свой скрипт, а не расширение браузера: инструменты, которыми можно
// водить чужой Chrome, отдают картинку в переписку и не кладут её на диск.
// А тур должен ссылаться на файл в репозитории.
//
// Аутентификация: скрипт заводит собственную сессию прямо в локальной базе
// и удаляет её в конце. Пароль владельца ему не нужен и не запрашивается.
// Работает только против локального dev-сервера.
//
//   node deploy/capture-screens.mjs
//
// Chrome запускается headless с отладочным портом, управление идёт по CDP
// через встроенный в Node WebSocket — без puppeteer и лишних зависимостей.

import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";

const BASE = "http://localhost:3000";
const COOKIE = "__Host-chanlyst_session";
const WIDTH = 1760;
const HEIGHT = 1100;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9222;

const SHOTS = [
  { name: "products", path: "/dashboard/products?product=demo-larkfield" },
  {
    name: "channels",
    path: "/dashboard/channels?product=demo-larkfield",
    // The card that explains why a channel was kept only exists once one is
    // selected, and that card is half of what this screen is for.
    prepare:
      "[...document.querySelectorAll('button,a')]" +
      ".filter(e=>(e.textContent||'').includes('Capterra'))[0]?.click();",
  },
  {
    name: "outreach",
    path: "/dashboard/queue",
    // A fresh browser selects the first company, and the first company is
    // whatever the expansion happened to return. Pick the one with a checked
    // public address instead: the screen is meant to show the good case.
    prepare:
      "[...document.querySelectorAll('*')].filter(e=>e.children.length===0" +
      "&&/webwork-tracker\\.com/.test(e.textContent)).slice(0,1)" +
      ".forEach(e=>e.closest('li,tr,div[class*=row],div')?.click());",
  },
  { name: "results", path: "/dashboard/results" },
  { name: "agent", path: "/dashboard/agent" },
];

const db = globSync(
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite",
).find((file) => {
  const has = sql(file, "SELECT count(*) FROM sqlite_master WHERE name='sessions'");
  return has.trim() === "1";
});
if (!db) throw new Error("local database not found — start the dev server once");

function sql(file, query) {
  return execFileSync("sqlite3", [file, query], { encoding: "utf8" });
}

const token = randomBytes(27).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const now = new Date();
const expires = new Date(now.getTime() + 3600_000);
const [userId] = sql(db, "SELECT id FROM users LIMIT 1").trim().split("\n");
const [workspaceId] = sql(db, "SELECT id FROM workspaces LIMIT 1").trim().split("\n");
if (!userId || !workspaceId) throw new Error("no owner in the local database");

sql(
  db,
  `INSERT INTO sessions (token_hash, user_id, workspace_id, expires_at, created_at, last_seen_at)
   VALUES ('${tokenHash}', '${userId}', '${workspaceId}',
           '${expires.toISOString()}', '${now.toISOString()}', '${now.toISOString()}')`,
);
console.log(`session for ${userId} / ${workspaceId}, expires in an hour`);

const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--user-data-dir=/tmp/chanlyst-capture-profile",
  "about:blank",
], { stdio: "ignore" });

async function cdp() {
  // Chrome needs a moment before the debugging endpoint answers.
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Chrome did not open its debugging port");
}

const socket = new WebSocket(await cdp());
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));

let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });

await send("Page.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: false,
});
// localhost counts as a secure origin, so a __Host- cookie is accepted there.
await send("Network.setCookie", {
  name: COOKIE,
  value: token,
  url: BASE,
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
});

mkdirSync("public/tour", { recursive: true });

for (const shot of SHOTS) {
  await send("Page.navigate", { url: BASE + shot.path });
  // The dashboard fills itself from a dozen API calls after the first paint.
  await new Promise((resolve) => setTimeout(resolve, 4500));
  // The tour would otherwise cover the very screen being photographed.
  await send("Runtime.evaluate", {
    expression:
      "Object.keys(localStorage).filter(k=>k.startsWith('chanlyst.tour')).forEach(k=>localStorage.setItem(k,'done'));" +
      "document.querySelector('.tour-skip')?.click();",
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (shot.prepare) {
    await send("Runtime.evaluate", { expression: shot.prepare });
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const file = `public/tour/${shot.name}.png`;
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`${file} — ${Math.round(Buffer.from(data, "base64").length / 1024)} KB`);
}

socket.close();
chrome.kill();
// The session existed only for this run.
sql(db, `DELETE FROM sessions WHERE token_hash='${tokenHash}'`);
console.log("session removed");
