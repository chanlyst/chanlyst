// Chanlyst in production, without the development server.
//
// Until now the live site was served by `wrangler dev`. That is a developer's
// tool: it watches files for changes, keeps a DevTools inspector proxy on a
// websocket, maintains a dev-session registry, and writes a debug log with no
// size limit — none of which a server needs, and all of which runs anyway.
//
// It also exited with status 1 about five times a day and said nothing about
// why: an empty error line in the journal, nothing in its own log at the
// instant it went, no OOM kill, no full disk. Measured 14-15 August: five exits
// in twenty-four hours.
//
// This is the same runtime — Miniflare boots the same workerd with the same
// bindings against the same SQLite directory, so no data moves and no code
// changes — with the development machinery gone. If it still exits, the cause
// is in the part we kept, which is a much smaller place to look.
//
//   node deploy/serve.mjs --config dist/server/wrangler.json --port 3000 \
//     --persist-to /var/lib/chanlyst/state --env-file /etc/chanlyst/chanlyst.env
//
// Static files are served the same way wrangler served them: through the
// assets binding named in the built config, with the worker in front of it.

import { createServer } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Log, LogLevel, Miniflare } from "miniflare";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

/**
 * Parses the same env file wrangler read, so the two are never out of step.
 *
 * Deliberately plain: KEY=value, one per line, # for a comment, and quotes
 * stripped from around a value. It has to agree with what wrangler accepted,
 * not with dotenv's full grammar.
 */
function readEnvFile(path) {
  if (!path) return {};
  const vars = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const split = trimmed.indexOf("=");
    if (split < 1) continue;
    const key = trimmed.slice(0, split).trim();
    let value = trimmed.slice(split + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

const configPath = resolve(argument("config", "dist/server/wrangler.json"));
const config = JSON.parse(readFileSync(configPath, "utf8"));
const serverDir = resolve(configPath, "..");
const port = Number(argument("port", "3000"));
const host = argument("ip", "127.0.0.1");
const persistTo = argument("persist-to", "");
const bindings = readEnvFile(argument("env-file", ""));

/**
 * The D1 bindings, in the shape wrangler passes them.
 *
 * Miniflare keeps a local D1 database as a Durable Object, and the file it
 * lands in is keyed by the worker's name and the database's id together. Get
 * either wrong and it opens a DIFFERENT, EMPTY database and creates it happily
 * — which is what happened the first time this ran: sign-in failed on "no such
 * table: auth_attempts" beside a 560KB database full of tables.
 *
 * So both come from the built config, and the id follows wrangler's own rule
 * (d1DatabaseEntry in its source): the configured id, falling back to the
 * binding name.
 */
const d1 = Object.fromEntries(
  (config.d1_databases || []).map((entry) => [
    entry.binding,
    { id: entry.database_id || entry.binding },
  ]),
);

/**
 * Every module the worker might load, listed by hand.
 *
 * Miniflare can normally follow the imports out of the entry file, but it
 * cannot follow `import(someVariable)` — and that is exactly how the router
 * loads a route: the path is computed at request time, so nothing static
 * points at it. Left to itself Miniflare walks the graph, hits the first
 * dynamic specifier and refuses to start.
 *
 * wrangler solved this with `no_bundle` plus a rule that says "everything
 * under here is an ES module". This is the same answer, spelled out: walk the
 * directory the build produced and hand over the whole list. The entry goes
 * first because Miniflare treats module[0] as the worker.
 */
function collectModules(root, entry) {
  const found = [];
  const walk = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) walk(path);
      else if (/\.(js|mjs)$/.test(item.name)) found.push(relative(root, path));
    }
  };
  walk(root);
  const rest = found.filter((path) => path !== entry).sort();
  return [entry, ...rest].map((path) => ({ type: "ESModule", path: resolve(root, path) }));
}

const mf = new Miniflare({
  // Without this the worker's own console output goes nowhere. The application
  // writes its diagnostics that way — which discovery lane failed, what the
  // competitor gap cost, why a send was refused — and under wrangler they
  // reached the journal. They have to keep reaching it.
  log: new Log(LogLevel.INFO),
  // Part of the storage key, so it is not cosmetic: see the note on d1 above.
  name: config.name,
  // The built client directory, resolved against the config that names it.
  // Without this every hashed bundle under /assets/ is a 404 and the site
  // renders as unstyled HTML with no JavaScript — which is how this was found.
  ...(config.assets?.directory
    ? {
        assets: {
          directory: resolve(serverDir, config.assets.directory),
          // A file on disk wins, and everything else goes to the worker. The
          // other order — worker first — was tried and returns 404 for every
          // hashed bundle: the worker has no route for /assets/*, answers 404
          // itself, and nothing ever falls through to the file sitting there.
          routerConfig: { has_user_worker: true },
        },
      }
    : {}),
  modules: collectModules(serverDir, config.main || "index.js"),
  modulesRoot: serverDir,
  compatibilityDate: config.compatibility_date,
  compatibilityFlags: config.compatibility_flags || [],
  d1Databases: d1,
  bindings: { ...(config.vars || {}), ...bindings },
  // The same directory wrangler used, so this starts on the data that is
  // already there rather than on an empty database.
  ...(persistTo
    ? { d1Persist: `${persistTo}/v3/d1`, kvPersist: `${persistTo}/v3/kv`, r2Persist: `${persistTo}/v3/r2`, cachePersist: `${persistTo}/v3/cache` }
    : {}),
  // Miniflare's own listener is not used; requests come through the Node
  // server below, which is what nginx talks to.
  host,
  port: 0,
});

const server = createServer(async (nodeRequest, nodeResponse) => {
  const started = Date.now();
  const url = `http://${nodeRequest.headers.host || "localhost"}${nodeRequest.url}`;
  const method = nodeRequest.method || "GET";
  try {
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await new Promise((done, fail) => {
            const chunks = [];
            nodeRequest.on("data", (chunk) => chunks.push(chunk));
            nodeRequest.on("end", () => done(Buffer.concat(chunks)));
            nodeRequest.on("error", fail);
          });
    const response = await mf.dispatchFetch(url, {
      method,
      headers: nodeRequest.headers,
      body,
      duplex: "half",
    });
    nodeResponse.writeHead(
      response.status,
      Object.fromEntries(response.headers.entries()),
    );
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        nodeResponse.write(Buffer.from(value));
      }
    }
    nodeResponse.end();
    console.info(`${method} ${nodeRequest.url} ${response.status} (${Date.now() - started}ms)`);
  } catch (error) {
    // A failed request must not take the process with it — that is the whole
    // point of this file. It is logged with its cause and the server carries
    // on, because one broken route is not a reason for the site to go down.
    console.error(`${method} ${nodeRequest.url} 500`, error);
    if (!nodeResponse.headersSent) nodeResponse.writeHead(500);
    nodeResponse.end("Internal Server Error");
  }
});

// Node's default is to exit on an unhandled rejection. A background promise
// nobody awaited is a bug worth seeing, but it is not worth the site going
// down for nine seconds, which is exactly the trade the old setup made
// silently.
process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection", reason);
});
process.on("uncaughtException", (error) => {
  console.error("uncaught exception", error);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      void mf.dispose().finally(() => process.exit(0));
    });
    // A client holding a connection open must not delay a restart forever.
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}

await mf.ready;
server.listen(port, host, () => {
  console.info(`Chanlyst ready on http://${host}:${port}`);
});
