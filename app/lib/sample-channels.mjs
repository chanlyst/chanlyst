// A real run, shown in the hero before anyone is asked for anything.
//
// Seven people arrived from the first paid campaign, and not one clicked
// "Start free". The panel they saw showed a product called Acme Analytics
// moving through four abstract steps: it proved the interface exists, which
// nobody doubted, and said nothing about what comes out of it.
//
// These rows are the output instead. The product is Chanlyst itself, which is
// the one example publishable without borrowing a customer's data, and "here
// is what it found for us" is a claim a reader can check line by line.
//
// Every value was produced by a real run and read off the dashboard. If runs
// stop returning results like these, this file becomes a lie and has to change.
export const SAMPLE_PRODUCT = {
  name: "Chanlyst",
  domain: "chanlyst.com",
  audience: {
    en: "chanlyst.com · founders and operators",
    ru: "chanlyst.com · фаундеры и операторы",
  },
  /** What the run returned in total, so four rows are honestly a sample. */
  /** Re-read from production on 6 August 2026: the run now returns 46. */
  found: 46,
};

// Four rows because the panel holds four without scrolling, and these four
// because between them they cover all three groups: a stranger sees in one
// glance that a run returns free listings, paid slots and people to write to —
// not just the easy third.
// `mark` is what goes on the sign — the two letters a place is known by. Kept
// as data rather than sliced off the name, because "r/SaaS" and
// "TechnologyAdvice" do not abbreviate the same way.
export const HERO_CHANNELS = [
  { name: "G2", mark: "G2", domain: "g2.com", group: "free_listing", score: 90 },
  { name: "Capterra", mark: "Cp", domain: "capterra.com", group: "free_listing", score: 88 },
  {
    name: "TechnologyAdvice",
    mark: "Ta",
    domain: "technologyadvice.com",
    group: "paid_placement",
    score: 84,
  },
  { name: "r/SaaS", mark: "r/", domain: "reddit.com", group: "outreach", score: 76 },
];

// The count climbs as the rows appear. The last number is the real total the
// run returned; the ones before it are the animation getting there.
export const HERO_COUNTS = [11, 24, 37, SAMPLE_PRODUCT.found];

// After the list is found, one row is picked and its actions are shown, because
// a list on its own raises the question it does not answer: found them, now
// what. G2 is the one picked — it is the free, do-it-today path, which is the
// promise the ad makes, and the actions on it are the real ones from the
// channel card: the submission form, the tracking link, the placement status.
export const HERO_MENU_INDEX = 0;
