# Security

## Reporting a vulnerability

Use GitHub's private reporting:
**[Report a vulnerability](https://github.com/chanlyst/chanlyst/security/advisories/new)**

It opens a thread only you and the maintainers can read. Please don't open a
public issue for anything exploitable — the same code runs on other people's
servers, and they need a fix available before the details are.

Tell us what you did, what happened, and what an attacker gets out of it. A
proof of concept helps more than a scanner's severity score.

You will get a first reply within three days. If a fix is warranted, the
advisory carries the timeline, and you are credited unless you would rather not
be.

## What is worth reporting

This is a multi-tenant application that holds other people's credentials, so
the sharp edges are roughly where you would expect:

- **Cross-workspace access.** Every query is meant to be scoped by
  `workspace_id`. A path that reads or writes another workspace's products,
  channels, contacts or messages is the most serious class of bug here.
- **Stored OAuth tokens.** Gmail tokens are encrypted at rest with
  `INTEGRATION_ENCRYPTION_KEY`. Anything that returns one to a client, logs
  one, or decrypts one outside its own workspace.
- **Sending on someone's behalf.** Delivery re-checks eligibility against the
  live row immediately before handing an address to Gmail — a hidden button is
  guidance, not a boundary. A path that sends without that check, or that sends
  to an address the workspace never approved.
- **Server-side request forgery.** The app fetches pages it finds on the open
  web. `safePublicUrl` is what keeps that off private address space; a bypass
  matters.
- **Authentication.** Owner password sign-in, e-mail links, OAuth callbacks,
  session cookies, and the invite flow.

## What is not a vulnerability

- **Missing rate limits on your own install.** Put it behind a proxy that has
  them.
- **Costs run up by your own key.** Discovery calls OpenRouter and Serper. That
  is the product working.
- **A public e-mail address appearing in results.** Chanlyst collects addresses
  that sites publish on their own contact pages. If you want yours out of a
  particular install, ask the person running it.
- **Reports from an automated scanner with no working exploit.** Send the
  exploit.

## Running it safely

- `INTEGRATION_ENCRYPTION_KEY` is what stands between a stolen database file
  and a working Gmail token. Set it before connecting anything, keep it out of
  the repository, and rotate the OAuth grants if it ever leaks.
- `PUBLIC_BASE_URL` has to be the address a browser really uses. OAuth
  redirects are built from it.
- The owner password is hashed with PBKDF2-SHA256 at 600,000 iterations by
  `scripts/hash-password.mjs`. Put the hash in the environment, never the
  password.
- Nothing here is designed to be exposed without TLS.
