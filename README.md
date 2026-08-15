# Chanlyst

**Find the places your paying customers already are — not the people.**

You give Chanlyst a product URL. It works out who pays for that kind of thing,
then searches the open web for the directories, communities, newsletters,
creators, partners and marketplaces that already hold that audience. Every
result comes back with the reason it was kept, what to do about it, and whether
that means filling in a form, paying for a slot, or writing to a human.

For the ones that need a human, it finds a public contact, checks it on the
site's own pages, and drafts the message. Nothing is sent until you press send,
and it goes out through your own Gmail account.

Hosted at [chanlyst.com](https://chanlyst.com). This repository is the whole
thing — run it yourself and the only bills are the two API keys below.

![Discovered channels, each with the reason it was kept and what to do about it](docs/screenshots/channels.png)

---

## What it is not

- **Not a scraper of people.** It looks for places, and the only addresses it
  collects are the ones a site publishes on its own contact page.
- **Not an account driver.** Nothing logs into your accounts from a cloud
  proxy or a headless browser, which is the behaviour platforms ban. E-mail
  leaves from your own connected Gmail, on your click.
- **Not a bulk sender.** One message goes out per press. A sequence starts only
  after you start it, and stops itself the moment a reply arrives.

---

## Run it

```bash
git clone https://github.com/chanlyst/chanlyst.git
cd chanlyst
cp .env.example .env     # put your OpenRouter key in it
docker compose up
```

Then open <http://localhost:3000>.

You need a password hash for the owner login before you can sign in:

```bash
node scripts/hash-password.mjs 'your password'
```

Paste the output into `OWNER_PASSWORD_HASH` in `.env`, alongside a
`OWNER_LOGIN` of your choosing.

Everything else — Gmail sending, e-mail sign-in links, billing — is optional
and off until you configure it. `.env.example` explains each one where it
stands.

---

## What it costs to run

Two keys carry the whole product.

| | | |
|---|---|---|
| **OpenRouter** | required | Analyses the product, judges every candidate, writes the outreach. |
| **Serper** | strongly recommended | Google results. 2,500 free queries, then $0.30 per 1,000. |

Serper is optional in the sense that the app starts without it, and a bad idea
in every other sense. Measured on this codebase: a broad discovery run costs
about **$0.05** with Serper and about **$1.17** without — twenty-three times
more. Without it the model has to search on its own, and every page it pulls
arrives as input tokens priced at the expensive model's rate. Telegram channel
discovery, contact-page lookup and the competitor gap need it outright.

`SELF_HOST=1` is set in `.env.example`. It removes the plan quotas, which exist
to price the hosted service and mean nothing on a server where the API calls
are billed to you already. The subscription section hides itself separately,
whenever no payment provider is configured.

---

## How a run works

One press of **Prepare everything** walks a product through five steps, each
resumable, each visible while it runs:

1. **Analyse** — audience, commercial model, which acquisition motions fit, and
   the search queries this particular product needs.
2. **Discover** — eight specialised lanes search in parallel, two SERP pages
   deep. A later run rotates to the next window of queries and starts further
   down the results, because repeating the first run's questions returns the
   first run's answers.
3. **Expand** — direct buyers, as a separate bounded search.
4. **Enrich** — contact pages, read and checked against the site itself.
5. **Draft** — a message per channel that needs one, queued and unsent.

Each candidate is then read from its own page rather than from the model's
memory, and judged against the product. Anything live and real but aimed
elsewhere is grouped off rather than deleted — a wrong rejection is expensive
and invisible.

![The product card: passport, acquisition strategy and niche monitoring](docs/screenshots/products.png)

The screenshots are a real run against a made-up product — a time-tracking app
for freelance designers — so the channels in them are the ones Chanlyst
actually returned for it: a Forbes Advisor roundup, r/graphic_design, design
podcasts, a Zapier comparison post. Nothing in them is staged.

---

## Stack

TypeScript, React 19, Next.js 16 on [vinext](https://github.com/cloudflare/vinext)
and Vite. It runs on the Cloudflare Workers runtime through wrangler, with
SQLite (Cloudflare D1) underneath and Drizzle for the schema. The Docker image
exists because "clone it and work out the Workers runtime" would lose most
readers on the first evening.

`npm test` runs the suite — around 440 tests, no network, no API keys.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data model and how the
pieces fit.

---

## Licence

[AGPL-3.0](LICENSE). Use it, change it, run it for yourself or your clients. If
you run a modified version as a network service, the licence asks you to
publish your changes.

The hosted service at [chanlyst.com](https://chanlyst.com) is the same code
with the servers, the keys and the support attached, for people who would
rather not run it.
