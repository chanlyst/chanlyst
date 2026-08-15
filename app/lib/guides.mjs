// The guides, as data.
//
// Each entry is one search intent, taken from docs/SEO-CORE.md — a cluster of
// phrasings people actually typed, not a keyword somebody liked the look of.
// `targets` records which cluster the page is answering, and a test fails if
// two pages claim the same phrase: two pages chasing one intent split the
// signal and neither of them ranks.
//
// Content lives here rather than in JSX so the same text can be rendered, read
// by a test, and lifted into structured data without existing twice.

/**
 * @typedef {object} Guide
 * @property {string} slug URL segment under /guides.
 * @property {string} title The <title>, written for the result page.
 * @property {string} h1 The heading, written for the reader who arrived.
 * @property {string} description Meta description.
 * @property {string} updated ISO date this content was last checked.
 * @property {string[]} intro Paragraphs before the first heading.
 * @property {Array<{h2: string, body?: string[], list?: Array<[string, string]>}>} sections
 * @property {string[][]} faq Question and answer pairs, also emitted as schema.
 * @property {string[]} related Slugs of the other guides worth linking to.
 * @property {string[]} targets The search phrases this page is written for.
 */

/** @type {Guide[]} */
export const GUIDES = [
  {
    slug: "where-to-promote-your-saas",
    title: "Where to promote your SaaS: the three kinds of places, in order",
    h1: "Where to promote your SaaS",
    description:
      "Every place you can promote a SaaS is one of three kinds: somewhere you submit for free, somewhere you buy a placement, or someone you write to directly. Here is how to tell which your product qualifies for, and the order that wastes the least time.",
    updated: "2026-08-06",
    intro: [
      "Most answers to this question are a list of a hundred websites. A list is not the hard part — you can find one in a minute. The hard part is that most of the hundred will not take your product, several will take a payment and send nobody, and the order you approach them in changes how many of them say yes.",
      "So this is not a list. It is the shape of the answer: what kinds of places exist, how to tell in about two minutes whether a given one is worth your afternoon, and which to do first.",
    ],
    sections: [
      {
        h2: "There are only three kinds of place",
        body: [
          "Everything that could send you a customer falls into one of three buckets, and the buckets behave completely differently. Confusing them is the most common reason a promotion plan produces nothing.",
        ],
        list: [
          [
            "Free submission",
            "Directories, aggregators, launch platforms, awesome-lists. You fill in a form and wait. The cost is your time and the currency is qualifying: they have requirements, and most rejections are for failing one you did not read.",
          ],
          [
            "Paid placement",
            "Sponsored newsletter slots, directory upgrades, review-site vendor profiles, community sponsorships. Fast, measurable, and the only bucket where you can lose money rather than time. Ask for the last three sponsors and email one of them.",
          ],
          [
            "Direct outreach",
            "A person — a newsletter author, a community moderator, a YouTuber, someone who wrote a comparison post your product belongs in. Slowest to start, hardest to scale, and the only bucket where the answer can be a partnership rather than a link.",
          ],
        ],
      },
      {
        h2: "Why founders ask this on Reddit, and what the thread usually leaves out",
        body: [
          "A large share of the people searching this add \"reddit\" to the query, which is a precise signal: they want the answer from someone who did it, not from a vendor selling the thing being described.",
          "That instinct is right, and the threads are genuinely better than most vendor blogs. What the threads consistently leave out is the failure rate. Someone posts the twelve directories that worked; nobody posts the thirty that ignored them, which is the number that would have told you how to budget your week. Read the threads, then assume roughly half of any list will not respond and plan the week around that instead of around the successes.",
        ],
      },
      {
        h2: "How to judge a place in two minutes",
        body: [
          "Before you spend an hour on a submission, four checks eliminate most of what is not worth it.",
        ],
        list: [
          [
            "Does anyone read it?",
            "Open the site's own newest entries. If the most recent addition is from last year, the directory is a parked domain with a form. Check the date, not the design.",
          ],
          [
            "Are your competitors there?",
            "If three products in your category are listed, the category exists there and someone maintains it. If none are, you are either early or in the wrong place, and early is the rarer of the two.",
          ],
          [
            "What does it require?",
            "Read the submission rules before writing anything. A screenshot in the wrong ratio, a missing pricing page, a personal-domain email address — these are the actual reasons submissions get dropped, and all of them are cheap to fix beforehand and impossible to fix afterwards.",
          ],
          [
            "What does it want in return?",
            "Some directories want a backlink, some want a review, some want money, and some want you not to promote at all. The last kind is common in communities, and it is written in their FAQ.",
          ],
        ],
      },
      {
        h2: "The order that wastes the least time",
        body: [
          "Start with free submissions, because they are the only bucket where being rejected costs you nothing but an hour, and because they produce the assets — a listing page, a category, a comparison entry — that the other two buckets later point at.",
          "Move to direct outreach second, while the free submissions are still pending. A newsletter author who agrees to mention you takes three weeks from first email to publication, so it has to start before you need it, not when you do.",
          "Buy placements last, and only where you already have a number to compare against. A sponsorship is the only one of the three where you can spend the budget before finding out the audience was wrong, and the way to avoid that is to know what a visit from a free listing was worth first.",
        ],
      },
      {
        h2: "The part nobody writes down",
        body: [
          "Every list you find answers \"which places exist\". Almost none answers \"what did the place ask for, and what happened when I submitted\". That second question is the whole job, and it is the reason the same twenty directories appear on every list: whoever wrote the list copied it from the previous list, and none of them submitted.",
          "Keep your own record from the first submission — where, on what date, what it required, and what came back. After ten of them you will know which kinds of place answer, which reject, and what they reject for, and that record is worth more than any list of two hundred.",
        ],
      },
    ],
    faq: [
      [
        "How many places should I submit to?",
        "Enough that the pattern becomes visible, which is usually around twenty. Fewer than that and a run of silence tells you nothing; far more and you stop reading requirements properly, which is what causes the silence.",
      ],
      [
        "Do directory listings still help with SEO?",
        "Some do and most do not, and the ones that do are the ones with editorial standards — which is the same thing as saying the ones that are hard to get into. Treat a link as a bonus and judge a listing on whether its readers are your buyers.",
      ],
      [
        "Should I pay for a directory listing?",
        "Only after a free one from the same category has sent you a visitor you can trace. The paid tier of a directory that sends you nothing for free will send you nothing for money.",
      ],
    ],
    related: [
      "saas-directories",
      "product-hunt-alternatives",
      "find-early-adopters",
    ],
    targets: [
      "where to promote my saas",
      "how to promote your saas",
      "how to promote a saas product",
      "how to advertise saas",
      "how to market a saas product",
      "how to market my saas reddit",
      "how to promote your saas on reddit",
    ],
  },

  {
    slug: "saas-directories",
    title: "SaaS directory submission: what they ask for before they accept you",
    h1: "SaaS directory submission",
    description:
      "Lists of SaaS directories are everywhere. What none of them tell you is what each one requires before it will accept a submission — the assets, the account, and the rules that decide whether your listing goes live or quietly disappears.",
    updated: "2026-08-06",
    intro: [
      "There is no shortage of lists. One says 217 directories, another says 260, a third says 40 prioritised. They are largely the same directories in a different order, because each list was assembled from the previous ones.",
      "The question they all skip is the one that decides your afternoon: what does a directory require before it accepts you? Submissions do not usually get rejected. They get ignored, which looks the same and teaches you nothing. This page is about what causes that.",
    ],
    sections: [
      {
        h2: "The five kinds of directory, and what each one is really for",
        list: [
          [
            "Review platforms — G2, Capterra, GetApp, TrustRadius",
            "High authority, buyer traffic, and effectively gated by reviews: a profile with none ranks nowhere on their own category pages. The listing is free; the work is the reviews, and that work is the point.",
          ],
          [
            "Launch platforms — Product Hunt, BetaList, Uneed, Peerlist",
            "A dated event rather than a permanent listing. Traffic is concentrated in one day and mostly gone by the next, which is fine if you know that going in and plan what to do with the spike.",
          ],
          [
            "Alternative and comparison sites — AlternativeTo, SaaSHub",
            "Long-lived and search-driven: they rank for \"X alternatives\", and being listed puts you in front of somebody actively leaving a competitor. Slow, and the highest-intent traffic in this whole category.",
          ],
          [
            "Niche and category directories",
            "Small, often run by one person, usually the fastest to accept and the most likely to send visitors who convert — because the audience arrived for exactly your category rather than for software in general.",
          ],
          [
            "Aggregators and awesome-lists",
            "Mostly a link and rarely a visitor. Worth submitting because it is a ten-minute job, not worth building a week around.",
          ],
        ],
      },
      {
        h2: "What gets asked for",
        body: [
          "Across most submission forms the requirements repeat. Preparing these once turns an hour-long submission into a ten-minute one, and prepares you for the requirement that actually blocks you.",
        ],
        list: [
          [
            "A working product at a public URL",
            "Not a waitlist page. The most common silent rejection is a reviewer opening the link and finding an email capture form.",
          ],
          [
            "A pricing page",
            "Even for a free product. Several directories categorise by price and will not place a listing they cannot categorise.",
          ],
          [
            "Screenshots at a fixed size",
            "Usually of the product in use rather than the marketing page. Ratios differ per site and a wrong one is a rejection nobody will explain.",
          ],
          [
            "A company email address",
            "A submission from a Gmail address is treated as an individual, and some review platforms will not verify a vendor profile without a domain email.",
          ],
          [
            "A short and a long description",
            "Typically around 60 characters and around 300. Writing both in advance is the single biggest time saver across twenty submissions.",
          ],
          [
            "A logo on transparent background",
            "Square, and larger than you think — 512px is a common floor.",
          ],
        ],
      },
      {
        h2: "The rule that catches people out",
        body: [
          "Communities are not directories, and the two get mixed into the same list constantly. A Slack or Discord community will appear on a list of \"places to promote your SaaS\" and its own FAQ will say, in plain words, that promotion is not allowed.",
          "That is not a technicality to route around. Those rules are enforced by people who read every message, and the cost of testing them is losing the community permanently. If a place says no selling, the value there is participation over months — which is a real channel, just not one you can execute this week.",
        ],
      },
      {
        h2: "How to tell a live directory from a parked one",
        body: [
          "A large fraction of any list is dead. Three checks, none longer than a minute: look at the date on the newest listing, look at whether the newest listings have any traffic signals at all — votes, comments, reviews — and search the directory's own name plus \"submission\" to see whether anyone has written about getting in recently.",
          "If the newest entry is months old and unvoted, the form still works and nobody is on the other end. Submit anyway if it costs ten minutes, but do not count it.",
        ],
      },
      {
        h2: "What to record",
        body: [
          "Keep one row per submission: the directory, the date, what it required, whether it charged, and what came back. Within a month this is a better guide to your own market than any published list, because it is the only version of the list that has been tested against your product rather than against somebody else's.",
        ],
      },
    ],
    faq: [
      [
        "Are free SaaS directories worth the time?",
        "The good ones are, and \"good\" means the category is maintained and your competitors are already in it. A free listing on a maintained niche directory reliably beats a paid slot on a general one.",
      ],
      [
        "What is a SaaS directory?",
        "A site that lists software products by category so buyers can compare them — sometimes with reviews, sometimes with prices, sometimes just with a description and a link. They range from Gartner-owned review platforms to a single maintained page on somebody's blog.",
      ],
      [
        "Should I use a directory submission service?",
        "They save time and they submit the same generic entry everywhere, which is exactly what gets ignored by the directories that matter and accepted by the ones that do not. If you use one, do the ten directories you actually care about yourself.",
      ],
      [
        "How long does approval take?",
        "Anywhere from instant to never, with two weeks being a reasonable point to stop waiting. Most directories do not send a rejection, so treat silence past a fortnight as an answer.",
      ],
    ],
    related: [
      "where-to-promote-your-saas",
      "product-hunt-alternatives",
      "how-to-promote-an-ai-tool",
    ],
    targets: [
      "saas directory submission",
      "saas directory submission sites",
      "directory submission for saas startups",
      "submit startup to directories",
      "saas directories list",
      "free saas directories",
      "best saas directories",
      "b2b saas directories",
      "what is saas directory",
      "saas directory submission service",
      "startup submission sites",
    ],
  },

  {
    slug: "product-hunt-alternatives",
    title: "Sites like Product Hunt: where to launch, and in what order",
    h1: "Sites like Product Hunt",
    description:
      "Product Hunt is one launch, not the launch. Here are the platforms that still send real traffic, what each one is for, and the order to use them in so one product can launch several times without repeating itself.",
    updated: "2026-08-06",
    intro: [
      "Product Hunt still works, and it stopped being a strategy on its own some time ago. The front page favours makers who already have an audience, the traffic is concentrated in a single day, and by the following morning it is over.",
      "The useful reframe is that a launch is not an event you get one of. The same product can be introduced to six different audiences over six weeks, because they are genuinely different audiences — pre-launch testers, indie founders, developers, buyers comparing tools. What changes each time is which one you are talking to.",
    ],
    sections: [
      {
        h2: "What each platform is actually for",
        list: [
          [
            "BetaList — before you launch",
            "Pre-launch and beta products, an audience that signed up specifically to try unfinished things. Right when you need testers and a waitlist, wrong when you need customers.",
          ],
          [
            "Hacker News (Show HN) — technical products only",
            "The largest single traffic spike available to a developer tool, and the most demanding audience on this list. Show HN rewards a working thing you built and punishes marketing language. Post it when you can take the comments.",
          ],
          [
            "Indie Hackers — founders, not users",
            "Best when your product is for people building products, and when you write about how you built it rather than what it does. The audience is other founders, which is a customer base for some products and a mirror for others.",
          ],
          [
            "Uneed, Fazier, MicroLaunch, TinyLaunch — the smaller launch boards",
            "Lower traffic, far lower competition, and a same-week decision rather than a scheduled event. Useful as a rehearsal: launch here first, see which sentence people quote back, then take the improved version somewhere larger.",
          ],
          [
            "Peerlist, DevHunt — audience-specific",
            "Worth it when your product is for the audience they were built for and close to worthless otherwise. Check who is on the leaderboard before spending a day preparing.",
          ],
          [
            "AlternativeTo, SaaSHub — not launches at all",
            "Permanent, search-driven listings rather than a dated event. No spike, and they keep sending people for years. Do these regardless of whether you launch anywhere.",
          ],
        ],
      },
      {
        h2: "A sequence that does not repeat itself",
        body: [
          "Pre-launch, BetaList, while there is still something to change. Then a small board — Uneed, MicroLaunch — as a rehearsal, and treat the first day's questions as the copy review they are.",
          "Then the permanent listings, because they take weeks to start ranking and nothing about them depends on timing. Then Product Hunt, once the landing page converts and you have a first sentence that has survived contact with strangers. Show HN last, or never, depending on whether it is that kind of product.",
          "Spacing them out is the point. Six launches in six weeks gives you six chances to fix the pitch; six launches in one week gives you one, plus the appearance of spam to anyone who follows more than one of these sites.",
        ],
      },
      {
        h2: "What a launch does and does not do",
        body: [
          "A launch produces a spike of visitors who came to look at something new, which is a specific and limited thing. It is excellent for finding out whether your first screen explains the product, and unreliable as a source of customers: launch-day audiences are shopping for novelty, not for a subscription.",
          "Judge the day on what you learned and what stayed — the signups still active in a fortnight, the sentence people repeated back to you, the objection three separate strangers raised. The vote count is the least informative number the day produces.",
        ],
      },
    ],
    faq: [
      [
        "Can I launch the same product on several sites?",
        "Yes, and you should — they are different audiences. Space them out and rewrite the pitch for each, because posting one identical blurb to six boards in a week is the version of this that gets you ignored on all six.",
      ],
      [
        "Is Product Hunt still worth doing?",
        "Yes, once, and later than most people do it. It rewards a tight story and an existing audience, so it works better as the fourth thing you do than the first.",
      ],
      [
        "What is the best Product Hunt alternative for a B2B tool?",
        "The permanent comparison sites rather than the launch boards. Launch boards are full of consumer and indie products; someone searching for an alternative to the incumbent in your category is a buyer, and that is a comparison-site visitor.",
      ],
    ],
    related: ["saas-directories", "where-to-promote-your-saas", "find-early-adopters"],
    targets: [
      "sites like product hunt",
      "product hunt similar sites",
      "product hunt alternatives",
      "best product hunt alternatives",
      "alternatives to product hunt",
      "other sites like product hunt",
      "similar sites like product hunt",
      "indie hackers alternatives",
      "where to launch your product",
      "saas launch checklist",
      "how to launch a saas product",
    ],
  },

  {
    slug: "how-to-promote-an-ai-tool",
    title: "How to promote an AI tool when the directories are already full",
    h1: "How to promote an AI tool",
    description:
      "AI tool directories were the easiest distribution on the internet for about eighteen months, and then everyone arrived. What still works for an AI product, and what is now just a form you fill in for nothing.",
    updated: "2026-08-06",
    intro: [
      "Between roughly 2023 and 2025, submitting an AI tool to directories was close to free distribution: the directories were new, hungry for entries, and ranking for every \"AI tool for X\" search there was.",
      "That window is mostly shut. The large AI directories now hold thousands of entries, new submissions land on page forty of a category, and a growing number charge for the placement that used to be the free tier. This is not a reason to skip them. It is a reason to stop treating them as the plan.",
    ],
    sections: [
      {
        h2: "What the directories are worth now",
        body: [
          "Two or three of the large AI directories still send meaningful traffic, and the rest send a backlink. The way to tell them apart takes a minute: open a category page and see whether the entries have visible engagement, and check whether the directory itself ranks for its category terms. If it does not rank, being listed on it cannot help you.",
          "Submit to the handful worth submitting to, in an afternoon, and stop. The difference between ten AI directories and eighty is measured in your evenings, not in signups.",
        ],
      },
      {
        h2: "What replaced them",
        list: [
          [
            "The category term, not the AI term",
            "Nobody with a budget searches \"AI tool\". They search for the job — transcription, contract review, channel research. Competing on \"AI\" puts you in a category of thousands; competing on the job puts you against the incumbents who actually have the customers, which is a smaller and much better fight.",
          ],
          [
            "Comparison and alternative pages",
            "Anyone leaving a tool in your category searches for its alternatives, and they are further along than any directory visitor. Listings on comparison sites, and a genuinely fair comparison page of your own, outlast every launch.",
          ],
          [
            "The communities that already discuss the problem",
            "Not the AI communities — the communities of the people whose job your tool does. They discuss the manual version of the problem daily. Most have rules against promotion, and being useful there for a month is still a faster route than the eightieth directory.",
          ],
          [
            "Showing the output",
            "AI products are unusually easy to demonstrate and unusually hard to describe. A public artefact — a real run, a real result with its sources — does more than a page of adjectives, and it is the one asset a competitor cannot copy from your marketing site.",
          ],
        ],
      },
      {
        h2: "The wrapper question, and why it is a distribution problem",
        body: [
          "Every AI product now gets read against the same suspicion: that it is a thin layer over a model anyone could prompt themselves. Fair or not, it is the first thing a reviewer, a directory editor and a potential buyer all silently ask.",
          "It matters here because it is what decides whether a listing gets approved and whether a community tolerates the mention. The answer is never a claim about proprietary technology. It is showing the work that is not the model: where the data comes from, what gets checked before a result is shown, what the product does that would still be tedious if you had the same model and an afternoon.",
          "Products that can answer that in one sentence get accepted in places that reject the rest of the category, and the sentence is worth more time than the next ten submissions.",
        ],
      },
      {
        h2: "The credibility problem specific to AI products",
        body: [
          "Buyers have now been burned by tools that produced confident, wrong output, and they have learned to assume it. That skepticism is the real obstacle in this category, ahead of price and ahead of features.",
          "The answer is not stronger claims. It is showing the sources: where a result came from, when it was checked, and what the tool does when it is not sure. A product that admits uncertainty reads as more trustworthy than one that never does, and in this category trust is the whole conversion problem.",
        ],
      },
    ],
    faq: [
      [
        "Are AI tool directories still worth submitting to?",
        "A few are and most are not. Submit to the ones that visibly rank for their own category terms, spend an afternoon on it, and treat the rest as backlinks rather than as a channel.",
      ],
      [
        "Should I describe my product as an AI tool?",
        "Only where being AI is the thing being bought. Everywhere else lead with the job it does — \"AI\" describes how it works, and buyers search for what they need done.",
      ],
      [
        "How do I get a paying customer for an AI product?",
        "Show the output before asking for the account. The gap between what these products promise and what they deliver is the buyer's live concern, and a real result answers it faster than any copy.",
      ],
    ],
    related: ["saas-directories", "where-to-promote-your-saas", "find-early-adopters"],
    targets: [
      "how to promote ai tools",
      "ai saas directories",
      "where to advertise an ai tool",
      "how to market an ai tool",
    ],
  },

  {
    slug: "how-to-promote-a-chrome-extension",
    title: "How to promote a Chrome extension after it is published",
    h1: "How to promote a Chrome extension",
    description:
      "Publishing an extension to the Chrome Web Store is documented everywhere. Getting anyone to install it is not. What actually drives installs: store search, the places extensions get discovered, and the review threshold nobody mentions.",
    updated: "2026-08-06",
    intro: [
      "Search for how to promote a Chrome extension and you get instructions for publishing one — the developer account, the fee, the manifest, the review queue. That is the part Google documents. The part nobody writes down is what happens after it is live, which is usually nothing.",
      "An extension is not a website with a different wrapper. Its discovery works differently, its conversion is unusually good, and the channels that work for a SaaS mostly do not apply.",
    ],
    sections: [
      {
        h2: "The Web Store is your main channel, and it is a search engine",
        body: [
          "Most installs of a small extension come from inside the store, from someone searching for the thing it does. That makes the listing itself the highest-leverage thing you control, and most listings are written as if nobody will ever search.",
        ],
        list: [
          [
            "The name carries the search",
            "Store search leans heavily on the title. A memorable brand name with no descriptive words in it is invisible; a name that includes what the extension does is findable. Many successful listings use both.",
          ],
          [
            "The first line of the description",
            "It is what gets shown in results and it is where the descriptive phrasing belongs. Write it as the sentence someone would type.",
          ],
          [
            "Screenshots do the converting",
            "The store shows them large and early. Show the extension doing its job inside a real page, not a marketing graphic with a headline on it.",
          ],
          [
            "Ratings gate everything",
            "Below a handful of reviews the listing reads as abandoned, and the store surfaces it accordingly. The first ten reviews are worth more effort than the next hundred installs — ask the first users directly, once, and do not nag.",
          ],
        ],
      },
      {
        h2: "Where extensions actually get discovered outside the store",
        list: [
          [
            "The community for the site it modifies",
            "An extension is almost always attached to a specific product or workflow — a Gmail extension, a Jira extension, a Twitch extension. That product's community is the entire relevant audience and it is usually one forum or subreddit. This single channel outperforms everything else on this page.",
          ],
          [
            "Comparison and alternative sites",
            "People replacing an extension that broke after a Manifest update search for alternatives. This is small, constant, and unusually high-intent traffic.",
          ],
          [
            "Show HN and developer boards",
            "Works when the extension is technically interesting or solves a developer's own annoyance, and is a waste when it is not.",
          ],
          [
            "A video of it working",
            "Thirty seconds of screen capture explains an extension better than any description, and it is the one asset that works in every other channel on this list.",
          ],
        ],
      },
      {
        h2: "Why extension marketing looks so different from SaaS marketing",
        body: [
          "Two things about extensions break the usual playbook. The install is close to free — one click, no account, no card — so the conversion rate from an interested visitor is far higher than any SaaS landing page achieves. And the retention is close to invisible: the extension sits in a toolbar, and a user who stopped opening it does not churn, they simply forget.",
          "Both push in the same direction. Spend less effort persuading and more on being found by someone who already wants the thing, because persuasion is barely needed once they arrive. And build one reason to come back — a weekly summary, a visible counter, anything that reminds the user the extension exists — because an unremembered extension produces no reviews, and reviews are what the store ranks on.",
        ],
      },
      {
        h2: "The permissions problem",
        body: [
          "The install dialog lists what your extension can access, and \"read and change all your data on all websites\" is where a meaningful share of installs stop. It is a legitimate hesitation and it is the biggest conversion problem an extension has.",
          "Request the narrowest permissions that work, use optional permissions where the platform allows it, and say plainly on the listing why each one is needed. An extension that explains its permissions converts better than one that hopes nobody reads them.",
        ],
      },
    ],
    faq: [
      [
        "How do I get the first users for a Chrome extension?",
        "From the community of whatever your extension modifies. If it changes Gmail, the people who want it are already discussing Gmail annoyances somewhere specific, and that one place will outperform every general launch board.",
      ],
      [
        "Does publishing to the Chrome Web Store cost anything?",
        "There is a one-time developer registration fee for a Chrome Web Store account. Publishing extensions after that costs nothing.",
      ],
      [
        "Why does my extension get impressions but no installs?",
        "Almost always the screenshots or the permissions. The listing is being found and something on it is stopping people — and those two are what people look at before deciding.",
      ],
    ],
    related: ["where-to-promote-your-saas", "find-early-adopters", "product-hunt-alternatives"],
    targets: [
      "how to promote a chrome extension",
      "how to market a chrome extension",
      "how to publish chrome extension",
      "how to publish chrome extension for free",
    ],
  },

  {
    slug: "find-early-adopters",
    title: "Where to find early adopters (they are in places, not lists)",
    h1: "Where to find early adopters",
    description:
      "Early adopters are not a demographic you can buy a list of. They are people already doing your job by hand, and they gather in specific, findable places. Here is how to locate those places and what to do once you are in one.",
    updated: "2026-08-06",
    intro: [
      "The standard advice is to find people who feel the problem acutely, which is true and useless. It describes who they are without saying where they are, and where is the entire question.",
      "The reliable version is narrower: your early adopters are the people already solving this problem badly. They have a spreadsheet, a manual routine, a workaround they complain about. That behaviour is visible in public, which means it is searchable.",
    ],
    sections: [
      {
        h2: "Find the workaround, and you have found the person",
        body: [
          "Nobody searches for a product category they have never heard of. They search for help with the manual version — the spreadsheet template, the script, the \"how do I keep track of\" question. Those searches and the threads that answer them are where your first users are, and they were there before your product existed.",
          "Search for the workaround rather than the category. The threads that come back are simultaneously a list of places and a list of people, and the person who wrote the most detailed answer in each thread is usually the best first conversation you will have.",
        ],
      },
      {
        h2: "The four places this actually happens",
        list: [
          [
            "Question threads",
            "Reddit, Stack Exchange, and specialist forums, where the same question is asked every few months and answered with a workaround. Recurrence is the signal: a problem asked once is a person, asked quarterly it is a market.",
          ],
          [
            "Professional communities",
            "The Slack and Discord groups for a job title rather than a technology. Highest concentration of the right people and the strictest rules — most state plainly that promotion is not allowed, and they mean it.",
          ],
          [
            "The tool they currently misuse",
            "Every workaround is built on something: a spreadsheet, an automation tool, a note-taking app. That tool's own community is full of people describing your problem in their vocabulary.",
          ],
          [
            "Pre-launch platforms",
            "BetaList and similar exist specifically for people who enjoy trying unfinished things. A narrower kind of early adopter — enthusiastic, forgiving, and not always representative of who eventually pays.",
          ],
        ],
      },
      {
        h2: "What to do once you have found the place",
        body: [
          "The mistake is arriving with the product. The people in these places have seen dozens of founders do exactly that, and the rules exist because of it.",
          "Arrive with the problem instead. Answer the question that brought you there — properly, without mentioning what you are building — and the conversation that follows is the one you wanted. It is slower than posting a link and it is the difference between being welcome and being removed.",
          "When you do mention the product, say it is yours. Every community rule that permits mentioning a product at all attaches that condition, and disclosure is also what makes the mention believable.",
        ],
      },
      {
        h2: "How to know they are the right ones",
        body: [
          "An early adopter who is genuinely in your market does two things: they describe the workaround in detail without being asked, and they ask what it costs. Enthusiasm without either of those is a person who likes new tools, which is pleasant and not a signal.",
          "Ten specific conversations tell you more than a thousand visitors. Have them before you build the next feature, not after.",
        ],
      },
    ],
    faq: [
      [
        "How many early adopters do I need?",
        "Around ten who use it more than once. That is enough for the same complaint to appear three times, which is the point at which you know what to build next.",
      ],
      [
        "Can I find early adopters on LinkedIn?",
        "You can find the job titles there, which is not the same thing. LinkedIn tells you who someone is; the communities tell you what they are struggling with this week, and the second is what you need.",
      ],
      [
        "Should I offer early adopters a discount?",
        "Access and attention work better than a discount. People who came for a discount tell you about your price, and people who came for the problem tell you about your product.",
      ],
    ],
    related: [
      "where-to-promote-your-saas",
      "product-hunt-alternatives",
      "how-to-promote-an-ai-tool",
    ],
    targets: [
      "where to find early adopters",
      "how to find early adopters",
      "how to get early adopters",
      "how to get early adopters for startup",
      "how to identify early adopters",
    ],
  },
];

/** @param {string} slug */
export function guideBySlug(slug) {
  return GUIDES.find((guide) => guide.slug === slug) || null;
}

export const GUIDE_SLUGS = GUIDES.map((guide) => guide.slug);
