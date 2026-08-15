import assert from "node:assert/strict";
import test from "node:test";

import { validateOutreachRecipient } from "../app/lib/outreach-recipient.mjs";

function lead(overrides = {}) {
  return {
    status: "approved",
    outreachEligible: 1,
    email: "Editor@Example.com",
    telegram: "",
    linkedin: "",
    contactStatus: "verified_public",
    contactEvidence: "Public contact page",
    opportunityType: "partner",
    actionType: "propose_partnership",
    ...overrides,
  };
}

test("an approved lead with a verified public email is sendable", () => {
  assert.deepEqual(validateOutreachRecipient(lead()), {
    ok: true,
    email: "editor@example.com",
  });
});

test("a syntactically valid but unverified email cannot be sent", () => {
  assert.deepEqual(
    validateOutreachRecipient(lead({ contactStatus: "found_unverified" })),
    { ok: false, error: "verified_email_required" },
  );
});

test("approval is required for an interactive send", () => {
  assert.deepEqual(validateOutreachRecipient(lead({ status: "review" })), {
    ok: false,
    error: "lead_approval_required",
  });
});

test("the qualified pipeline gate still requires eligibility and verification", () => {
  assert.deepEqual(
    validateOutreachRecipient(lead({ outreachEligible: 0 }), {
      gate: "qualified",
    }),
    { ok: false, error: "lead_not_qualified" },
  );
  assert.deepEqual(
    validateOutreachRecipient(lead({ status: "review" }), {
      gate: "qualified",
    }),
    { ok: true, email: "editor@example.com" },
  );
});

test("a network-routed opportunity cannot be emailed", () => {
  assert.deepEqual(
    validateOutreachRecipient(
      lead({ opportunityType: "affiliate_network", actionType: "register" }),
    ),
    { ok: false, error: "lead_not_qualified" },
  );
});

test("verification does not rescue an invalid email address", () => {
  assert.deepEqual(validateOutreachRecipient(lead({ email: "not-an-email" })), {
    ok: false,
    error: "verified_email_required",
  });
});
