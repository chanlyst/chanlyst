# Contributing

## Getting it running

```bash
npm install
cp .env.example .env          # OPENROUTER_API_KEY is the only one you need to start
node scripts/hash-password.mjs 'a password'   # into OWNER_PASSWORD_HASH
npm run dev
```

Then <http://localhost:3000>, and sign in with the owner login.

Without `SERPER_API_KEY` discovery still runs, badly and expensively — see the
README for the measured difference. Everything else in `.env.example` is
optional and off until you fill it in.

## Before you open a pull request

```bash
npm test
```

That is a typecheck, a production build and the whole suite in one command —
432 tests, no network, no API keys. It has to pass.

(The private repository runs 440. The eight that do not travel check internal
documents the publish script strips — they would fail here for the absence of
a file rather than for anything about the code.)

```bash
npm run lint
```

## What gets merged quickly

- A bug with a test that fails before the change and passes after it.
- A new discovery source, or a better query for an existing one, **with the
  measurement**: how many candidates it returned, how many survived, what it
  cost. Every source in here earned its place that way and several were removed
  the same way.
- Anything that makes a self-hosted install less fiddly.
- Corrections to the English or the Russian.

## What needs a conversation first

Open an issue before writing the code:

- A new dependency. This runs on the Cloudflare Workers runtime, where a lot of
  Node packages do not, and the dependency list is deliberately short.
- A schema change. Migrations are append-only and run automatically against
  live installs; a bad one is not something the person running it can undo.
- Anything that sends without a human pressing send. That is the line the whole
  product is built on, and it is not moving.
- Scraping people rather than places — logging into accounts, driving browsers,
  harvesting addresses that a site did not publish. This is not that kind of
  tool, and the answer will be no.

## House style

The code here explains itself in comments, and the comments say **why**, not
what. Where a number was measured, the comment carries the measurement — the
run that cost $0.1334, the thirteen matches of which four were real, the page
that shares no links with the one above it. When you change one of those,
change the number with it or delete the claim.

Commit messages are prose, not a changelog line. Say what was wrong and how you
know.

## Licence

Contributions are accepted under [AGPL-3.0](LICENSE), the licence the project
already carries.
