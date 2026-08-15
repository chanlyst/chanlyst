// What the public page is allowed to say about a channel.
//
// The page publishes a real run out of the production database, which means
// the interesting question is not what to show but what must never leave. Two
// rules, both enforced here rather than in the template:
//
//   1. No person. Contacts are excluded by the query — the columns are simply
//      not selected — and this module never reads them, so a later template
//      cannot start showing what was never loaded.
//   2. No link that is a way to reach somebody. A registration URL is a
//      submission form, except when discovery stored a mailto: or a Telegram
//      handle in it, which happens. Anything that is not plain http(s) is
//      dropped rather than rendered.
//
// The second rule is why linkFor exists at all: without it the first rule
// leaks through a field nobody thinks of as a contact.

import { engagementModeForLead } from "./engagement-mode-core.mjs";

/** The three buckets, in the order the page reads. */
export const FOUND_GROUPS = ["free_listing", "paid_placement", "outreach"];

export const GROUP_LABELS = {
  free_listing: "Submit it yourself, free",
  paid_placement: "Paid placement",
  outreach: "Someone has to be written to",
};

export const GROUP_NOTES = {
  free_listing: "A form, an afternoon and whatever the place requires.",
  paid_placement:
    "Worth having, and it starts with asking a price. Where a price is published it is below; where it is not, that is what the card says.",
  outreach:
    "A person decides. The people themselves are not published here — only the place and its public terms.",
};

/**
 * Which bucket a channel belongs to.
 *
 * Deliberately not channelGroup() from channel-groups.mjs: that one needs the
 * contact route, the contact route needs the email, the telegram and the
 * LinkedIn, and those are exactly the columns this page must never load. Three
 * buckets computed from non-personal fields is both what the page shows and
 * the reason it can stay honest.
 *
 * @param {Record<string, unknown>} channel
 */
export function foundGroup(channel) {
  return engagementModeForLead(channel);
}

/**
 * A link, or nothing.
 *
 * @param {unknown} value
 * @returns {string} an http(s) URL, or "" — never a mailto:, tel: or javascript:
 */
export function linkFor(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

/** The host, for showing a domain without the scheme and the trailing slash. */
export function hostFor(channel) {
  const direct = String(channel.domain || "").trim();
  if (direct) return direct.replace(/^www\./, "");
  const link = linkFor(channel.url);
  if (!link) return "";
  try {
    return new URL(link).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * What a submission is doing right now, in words, or "" when the channel has
 * no submission yet. Deliberately says nothing rather than inventing a stage.
 *
 * @param {Record<string, unknown>} channel
 */
export function placementLabel(channel) {
  switch (String(channel.placementStatus || "")) {
    case "to_submit":
      return "Ready to submit";
    case "submitted":
      return "Submitted, waiting";
    case "published":
      return "Published";
    case "rejected":
      return "Rejected";
    default:
      return "";
  }
}

/**
 * The gaps, named.
 *
 * The point of publishing a real run is that it shows the real quality of the
 * output, and the missing terms are part of that. A card with nothing under
 * "price" is more honest than a card that quietly omits the heading, so the
 * absence gets a label of its own.
 *
 * @param {Record<string, unknown>} channel
 */
export function termsFor(channel) {
  const clean = (value) => String(value || "").trim();
  return [
    ["What it requires", clean(channel.placementRequirements)],
    ["Price", clean(channel.pricingSummary)],
    ["Terms of use", clean(channel.usageTerms)],
  ].map(([label, value]) => [label, value, value ? "" : "not published"]);
}

/**
 * The page's own view of a database row: everything shown, nothing else.
 *
 * @param {Record<string, unknown>} row
 */
export function publicChannel(row) {
  return {
    id: String(row.id || ""),
    name: String(row.company || "").trim(),
    host: hostFor(row),
    url: linkFor(row.url),
    // Where to go next. For a paid placement that is the advertise or media
    // kit page rather than a submission form, so the two fields are one link
    // with a label that changes — see submitLabel below. Never taken from an
    // outreach row: there the action is a person.
    submitUrl:
      foundGroup(row) === "outreach"
        ? linkFor(row.registrationUrl)
        : linkFor(row.registrationUrl) || linkFor(row.actionUrl),
    placementUrl: linkFor(row.placementUrl),
    group: foundGroup(row),
    submitLabel:
      foundGroup(row) === "paid_placement" ? "where to ask" : "where to submit",
    score: Number(row.score || 0),
    // What the channel's own page says it is, which is the check on whether
    // discovery understood the site at all.
    siteTitle: String(row.siteTitle || "").trim(),
    reason: String(row.reason || "").trim(),
    terms: termsFor(row),
    placement: placementLabel(row),
    checkedAt: String(row.placementCheckedAt || row.updatedAt || "").slice(0, 10),
    doubtful: String(row.relevance || "") === "doubtful",
  };
}

/**
 * The whole page: the channels grouped, and the counts the headline uses.
 *
 * @param {Array<Record<string, unknown>>} rows
 */
export function foundSummary(rows) {
  const all = rows.map(publicChannel);

  // A term nobody in the run has is not a gap in the answer, it is an unused
  // field: usage terms are empty for all 46 channels, and printing "not
  // published" forty-six times reads as a broken page rather than an honest
  // one. Per-channel gaps still show, because those are real variance.
  const present = new Set(
    all.flatMap((channel) =>
      channel.terms.filter(([, value]) => value).map(([label]) => label),
    ),
  );
  const channels = all.map((channel) => ({
    ...channel,
    terms: channel.terms.filter(([label]) => present.has(label)),
  }));

  const groups = FOUND_GROUPS.map((key) => ({
    key,
    label: GROUP_LABELS[key],
    note: GROUP_NOTES[key],
    channels: channels
      .filter((channel) => channel.group === key)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
  })).filter((group) => group.channels.length > 0);

  // Counted per term rather than as one "has nothing" figure. The single
  // figure was 35 of 46 and it was true and it was misleading: every channel
  // here is explained and half carry a submission link, so "35 with no terms"
  // read as forty-six empty cards. What is actually thin is the hard terms,
  // and saying which is both more honest and less damning.
  const counted = (label) =>
    all.filter((channel) =>
      channel.terms.some(([term, value]) => term === label && value),
    ).length;

  return {
    total: channels.length,
    published: channels.filter((channel) => channel.placement === "Published").length,
    submitted: channels.filter((channel) => channel.placement === "Submitted, waiting").length,
    withRequirements: counted("What it requires"),
    withPrice: counted("Price"),
    groups,
  };
}
