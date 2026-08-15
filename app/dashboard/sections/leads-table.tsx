import { Fragment, useState } from "react";
import type { Dictionary, Locale } from "../i18n";
import { parseAffiliateHint } from "../../lib/contact-extract.mjs";
import { channelGroup } from "../../lib/channel-groups.mjs";
import {
  contactNetworkFor,
  contactRouteForLead,
  engagementModeForLead,
  isSupplySideChannel,
  leadsPerPage,
  type BusyState,
  type EngagementMode,
  type Lead,
  type LeadComment,
  type LeadModeCounts,
  type LeadModeFilter,
  type PlacementCounts,
  type PlacementStatus,
  type WorkspaceMember,
} from "../types";

// Full days elapsed since an ISO timestamp; null when the value is missing
// or unparsable so the caller can hide the hint instead of showing NaN.
function daysSince(value?: string | null) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

const placementCheckAfterDays = 5;

/**
 * The heading that opens a group, rendered only where the group actually
 * changes. A chip already narrows the list to one group, so headings would
 * repeat the chip and are left out there; the same applies to the doubtful
 * view, which is a verdict rather than a group.
 */
function groupHeadingFor(
  lead: Lead,
  previous: Lead | undefined,
  filter: LeadModeFilter,
  t: Dictionary,
) {
  if (filter !== "all") return null;
  const group = channelGroup(lead);
  if (previous && channelGroup(previous) === group) return null;
  const [title, hint] = {
    free_listing: [t.groupFreeListing, t.groupFreeListingHint],
    paid_placement: [t.groupPaidPlacement, t.groupPaidPlacementHint],
    outreach: [t.groupOutreach, t.groupOutreachHint],
    network: [t.groupNetwork, t.groupNetworkHint],
  }[group];
  return (
    <p className={`lead-group ${group}`}>
      <b>{title}</b>
      <i>{hint}</i>
    </p>
  );
}

// The last automatic check of this channel, in one quiet line. Nothing here
// asks for attention: a problem worth acting on already became a task in the
// «Сегодня» block, this only tells the user monitoring is running.
function watchLine(lead: Lead, t: Dictionary) {
  const days = daysSince(lead.watchCheckedAt);
  if (days === null) return "";
  const code = Number(lead.watchStatusCode) || 0;
  const verdict =
    code === 0 || code >= 500
      ? t.watchPageUnreachable
      : code === 404 || code === 410
        ? t.watchPageGone
        : Number(lead.watchMentionsProduct) === 1
          ? t.watchListingPresent
          : t.watchListingMissing;
  const when =
    days === 0
      ? t.watchCheckedToday
      : t.watchCheckedDaysAgo.replace("{days}", String(days));
  return `${when} · ${verdict}`;
}

// Compact relative time for comments ("5 мин назад" / "2 d ago").
function relativeTime(value: string, locale: Locale) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return "";
  const seconds = Math.round((parsed - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(
    locale === "ru" ? "ru-RU" : "en-US",
    { numeric: "auto" },
  );
  const absolute = Math.abs(seconds);
  if (absolute < 60) return format.format(Math.trunc(seconds), "second");
  if (absolute < 3600) return format.format(Math.trunc(seconds / 60), "minute");
  if (absolute < 86_400) return format.format(Math.trunc(seconds / 3600), "hour");
  return format.format(Math.trunc(seconds / 86_400), "day");
}

// The draft lives here so a lead switch (new `key`) starts with a clean field.
function CommentsBlock({
  t,
  locale,
  comments,
  loading,
  busy,
  currentUserId,
  isOwner,
  addComment,
  deleteComment,
}: {
  t: Dictionary;
  locale: Locale;
  comments: LeadComment[];
  loading: boolean;
  busy: BusyState;
  currentUserId: string;
  isOwner: boolean;
  addComment: (body: string) => Promise<boolean>;
  deleteComment: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const ok = await addComment(body);
    if (ok) setDraft("");
  }

  return (
    <div className="lead-comments">
      <small>{t.commentsTitle}</small>
      {loading ? (
        <p className="comments-hint">{t.commentsLoading}</p>
      ) : comments.length === 0 ? (
        <p className="comments-hint">{t.commentsEmpty}</p>
      ) : (
        <ul>
          {comments.map((comment) => (
            <li key={comment.id}>
              <header>
                <strong>{comment.userName || "—"}</strong>
                <time dateTime={comment.createdAt}>
                  {relativeTime(comment.createdAt, locale)}
                </time>
                {(comment.userId === currentUserId || isOwner) && (
                  <button
                    type="button"
                    disabled={busy === "comment"}
                    onClick={() => void deleteComment(comment.id)}
                  >
                    {t.commentDelete}
                  </button>
                )}
              </header>
              <p>{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit}>
        <textarea
          value={draft}
          maxLength={2000}
          placeholder={t.commentPlaceholder}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          className="dark"
          type="submit"
          disabled={busy === "comment" || !draft.trim()}
        >
          {t.commentSubmit}
        </button>
      </form>
    </div>
  );
}

/**
 * Where this channel stands, for the row.
 *
 * The four statuses have always existed, with their buttons — inside the
 * channel card, which has to be opened one channel at a time. Working out how
 * many of twenty places had been submitted to meant opening twenty cards, so
 * in practice nobody marked anything and every counter read zero. The state
 * belongs where the list is scanned.
 *
 * Read-only here: the row is itself a button, and a control inside a control
 * is both invalid and ambiguous to click. Marking stays in the card; seeing
 * does not.
 */
function placementLabel(lead: Lead, t: Dictionary): string {
  const status = lead.placementStatus;
  if (!status) return "";
  return {
    to_submit: t.placementToSubmit,
    submitted: t.placementSubmitted,
    published: t.placementPublished,
    rejected: t.placementRejected,
  }[status] || "";
}

/**
 * Rivals recorded on this channel by the gap analysis.
 *
 * Each carries the page that proves it, and the badge links straight to it:
 * "your competitor is here" that cannot be checked is worth less than nothing,
 * because the first one that turns out wrong costs more trust than the whole
 * feature earns.
 */
function competitorsOf(lead: Lead): Array<{ name: string; url: string }> {
  if (!lead.competitorPresence) return [];
  try {
    const parsed = JSON.parse(lead.competitorPresence);
    return Array.isArray(parsed)
      ? parsed
          .filter((item) => item && item.name && item.url)
          .map((item) => ({ name: String(item.name), url: String(item.url) }))
          .slice(0, 2)
      : [];
  } catch {
    return [];
  }
}

export default function LeadsTable({
  t,
  locale,
  exportUrl,
  visibleLeads,
  totalLeads,
  leadCounts,
  placementCounts,
  newCount,
  loading,
  hasDiscovered,
  selectedLead,
  selectedLeadMode,
  leadModeFilter,
  leadPageCount,
  effectiveLeadPage,
  setLeadPage,
  busy,
  chooseLead,
  chooseLeadModeFilter,
  discover,
  updateLeadStatus,
  updateLeadPlacement,
  copyUtmLink,
  enrichContact,
  members,
  currentUserId,
  isOwner,
  assignedFilter,
  chooseAssignedFilter,
  assignLead,
  comments,
  commentsLoading,
  addComment,
  deleteComment,
}: {
  t: Dictionary;
  locale: Locale;
  exportUrl: string;
  visibleLeads: Lead[];
  totalLeads: number;
  leadCounts: LeadModeCounts;
  placementCounts: PlacementCounts;
  newCount: number;
  loading: boolean;
  hasDiscovered: boolean;
  selectedLead?: Lead;
  selectedLeadMode?: Exclude<EngagementMode, "unknown">;
  leadModeFilter: LeadModeFilter;
  leadPageCount: number;
  effectiveLeadPage: number;
  setLeadPage: (page: number) => void;
  busy: BusyState;
  chooseLead: (lead: Lead) => void;
  chooseLeadModeFilter: (nextFilter: LeadModeFilter) => void;
  discover: () => Promise<void>;
  updateLeadStatus: (id: string, status: "approved" | "rejected") => Promise<void>;
  updateLeadPlacement: (
    id: string,
    changes: { placementStatus?: PlacementStatus; placementUrl?: string },
  ) => Promise<void>;
  copyUtmLink: (lead: Lead) => Promise<void>;
  enrichContact: (lead: Lead) => Promise<void>;
  members: WorkspaceMember[];
  currentUserId: string;
  isOwner: boolean;
  assignedFilter: "all" | "mine";
  chooseAssignedFilter: (filter: "all" | "mine") => void;
  assignLead: (id: string, userId: string) => Promise<void>;
  comments: LeadComment[];
  commentsLoading: boolean;
  addComment: (body: string) => Promise<boolean>;
  deleteComment: (id: string) => Promise<void>;
}) {
  // Collaboration controls only make sense once a second member exists.
  const hasTeam = members.length > 1;
  // Header summary for self-serve filters, e.g. "3 к подаче · 2 поданы".
  // placementCounts covers the whole filtered set server-side, so the line
  // stays accurate under pagination.
  const placementSummary =
    leadModeFilter === "free_listing" || leadModeFilter === "paid_placement"
      ? (
          [
            ["to_submit", t.placementSummaryToSubmit],
            ["submitted", t.placementSummarySubmitted],
            ["published", t.placementSummaryPublished],
            ["rejected", t.placementSummaryRejected],
          ] as Array<[keyof PlacementCounts, string]>
        )
          .filter(([key]) => placementCounts[key] > 0)
          .map(([key, label]) => `${placementCounts[key]} ${label}`)
          .join(" · ")
      : "";
  const placementStatus = selectedLead?.placementStatus || "";
  // Supply-side channel: the user registers the offer instead of writing to
  // anybody, so the card offers the signup link and no outreach composer.
  const supplySide = Boolean(selectedLead && isSupplySideChannel(selectedLead));
  // Affiliate network found by enrichment on a channel that hides its contacts.
  const affiliateNetwork = parseAffiliateHint(selectedLead?.contactEvidence || "");
  // How this lead can be reached at all — the one question that decides which
  // primary action the card offers and whether the check button does anything.
  const contactRoute = selectedLead ? contactRouteForLead(selectedLead) : "direct";
  const networkRoute = selectedLead ? contactNetworkFor(selectedLead) : null;
  const contactCheckedDays = daysSince(selectedLead?.contactCheckedAt);
  const contactStatusValue = selectedLead?.contactStatus || "not_checked";
  // What the site says about itself, and whether that squared with the product.
  const siteSays = [selectedLead?.siteTitle, selectedLead?.siteDescription]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" — ");
  const doubtfulEntry = selectedLead?.relevance === "doubtful";
  const submittedDays =
    placementStatus === "submitted"
      ? daysSince(selectedLead?.placementSubmittedAt)
      : null;
  return (
        <section className="discovery" id="found">
          <div className="panel results">
            <div className="section-head"><div><div><h2>{t.found}</h2><p>{t.foundHint}</p></div></div><div className="head-actions">{totalLeads === 0 ? (
              <button className="outline export-csv" disabled>{t.exportCsv}</button>
            ) : (
              <a className="outline export-csv" href={exportUrl} download>{t.exportCsv}</a>
            )}<strong>{totalLeads}</strong></div></div>
            {!loading && newCount > 0 && (
              <p className="new-since-visit">
                {t.newSinceVisit.replace("{count}", String(newCount))}
              </p>
            )}
            {loading ? (
              <div className="lead-skeleton" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className="skeleton-row">
                    <span />
                    <div><i /><i /></div>
                    <b />
                  </div>
                ))}
              </div>
            ) : !leadCounts.all && leadModeFilter === "all" ? (
              <div className="empty"><span>◎</span><p>{hasDiscovered ? t.emptyNoResults : t.emptyNoDiscovery}</p><button className="lime" onClick={() => void discover()} disabled={busy === "discover"}>{t.find}</button></div>
            ) : (
              <>
              <div className="lead-filters">
                {([
                  ["all", locale === "ru" ? "Все" : "All"],
                  ["free_listing", locale === "ru" ? "Самостоятельно" : "Self-service"],
                  ["paid_placement", locale === "ru" ? "Платное размещение" : "Paid placement"],
                  ["outreach", locale === "ru" ? "Для рассылки" : "Outreach"],
                  // Leads whose way in is registering in an affiliate network:
                  // they are deliberately not in «Для рассылки» any more.
                  ["network_route", t.filterNetworkRoute],
                  // Only shown once the gap analysis has actually found
                  // something: an empty chip would advertise a feature the
                  // user has not run and cannot act on.
                  ...(leadCounts.competitors
                    ? ([["competitors", t.filterCompetitors]] as Array<[LeadModeFilter, string]>)
                    : []),
                  // Grouped off, not deleted: the user still decides.
                  ["doubtful", t.filterDoubtful],
                ] as Array<[LeadModeFilter, string]>).map(([mode, label]) => (
                  <button
                    key={mode}
                    className={leadModeFilter === mode ? "active" : ""}
                    onClick={() => chooseLeadModeFilter(mode)}
                  >
                    {label}
                    <b>{leadCounts[mode]}</b>
                  </button>
                ))}
                {hasTeam && (
                  <button
                    className={assignedFilter === "mine" ? "active" : ""}
                    onClick={() =>
                      chooseAssignedFilter(
                        assignedFilter === "mine" ? "all" : "mine",
                      )
                    }
                  >
                    {t.mineFilter}
                  </button>
                )}
              </div>
              {placementSummary && (
                <p className="placement-summary">{placementSummary}</p>
              )}
              <div className="lead-list">{visibleLeads.map((lead, index) => (
                <Fragment key={lead.id}>
                {groupHeadingFor(lead, visibleLeads[index - 1], leadModeFilter, t)}
                <button className={`${selectedLead?.id === lead.id ? "active" : ""} ${lead.status}`} onClick={() => chooseLead(lead)}>
                  <span className={`avatar ${engagementModeForLead(lead)}`}>
                    {lead.company.slice(0, 2).toUpperCase()}
                  </span>
                  <div><div><strong>{lead.company}</strong><small>{lead.channelType}</small>{competitorsOf(lead).map((rival) => (
                    <a
                      key={rival.name}
                      className="rival-tag"
                      href={rival.url}
                      target="_blank"
                      rel="noreferrer nofollow"
                      title={t.competitorUsesTitle}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {t.competitorUses.replace("{name}", rival.name)}
                    </a>
                  ))}</div><p>{lead.description}</p><em>{lead.domain} · {lead.source}</em>{placementLabel(lead, t) && (
                    <span className={`placement-tag ${lead.placementStatus}`}>{placementLabel(lead, t)}</span>
                  )}<span className="opportunity-tag">{isSupplySideChannel(lead) ? t.opportunityAffiliateNetwork : contactRouteForLead(lead) === "network" ? t.routeNetworkTag : locale === "ru" ? {
                    free_listing: lead.commercialModel === "free" ? "Бесплатно" : "Самостоятельно",
                    paid_placement: "Платное размещение",
                    outreach: "Для рассылки",
                  }[engagementModeForLead(lead)] : {
                    free_listing: lead.commercialModel === "free" ? "Free listing" : "Self-service",
                    paid_placement: "Paid placement",
                    outreach: "Outreach",
                  }[engagementModeForLead(lead)]}</span></div>
                  <b>{lead.score}<small>{t.forecast}</small>{Boolean(lead.commentCount) && <em className="comment-badge" title={t.commentsTitle}>✎ {lead.commentCount}</em>}</b>
                </button>
                </Fragment>
              ))}</div>
              {!totalLeads && (
                <div className="empty filtered-empty">
                  <span>◎</span>
                  <p>
                    {leadModeFilter === "doubtful"
                      ? t.doubtfulEmpty
                      : t.emptyNoResults}
                  </p>
                </div>
              )}
              {leadPageCount > 1 && (
                <nav className="lead-pagination" aria-label={locale === "ru" ? "Страницы каналов" : "Channel pages"}>
                  <span>
                    {(effectiveLeadPage - 1) * leadsPerPage + 1}–{Math.min(effectiveLeadPage * leadsPerPage, totalLeads)} {locale === "ru" ? "из" : "of"} {totalLeads}
                  </span>
                  <div>
                    <button disabled={effectiveLeadPage === 1} onClick={() => setLeadPage(Math.max(1, effectiveLeadPage - 1))}>←</button>
                    {Array.from({ length: leadPageCount }, (_, index) => index + 1).map((page) => (
                      <button className={page === effectiveLeadPage ? "active" : ""} key={page} onClick={() => setLeadPage(page)}>{page}</button>
                    ))}
                    <button disabled={effectiveLeadPage === leadPageCount} onClick={() => setLeadPage(Math.min(leadPageCount, effectiveLeadPage + 1))}>→</button>
                  </div>
                </nav>
              )}
              </>
            )}
          </div>
          <aside className="panel lead-detail">
            {selectedLead ? <>
              <div className="lead-title"><span className={`avatar ${engagementModeForLead(selectedLead)}`}>{selectedLead.company.slice(0, 2).toUpperCase()}</span><div><h3>{selectedLead.company}</h3><a href={selectedLead.url} target="_blank" rel="noreferrer">{selectedLead.domain}</a></div><b>{selectedLead.score}</b></div>
              <div className="why"><small>{t.whyLead}</small><p>{selectedLead.reason}</p></div>
              {/* The site's own words, so a mismatch is visible without
                  opening the site — this is what the model does NOT get to
                  paraphrase. */}
              {siteSays && (
                <div className="site-says">
                  <small>{t.siteSaysTitle}</small>
                  <p>{siteSays}</p>
                </div>
              )}
              {doubtfulEntry && (
                <div className="doubtful-hint">
                  <strong>{t.doubtfulTitle}</strong>
                  {selectedLead?.relevanceReason && (
                    <p className="doubtful-reason">{selectedLead.relevanceReason}</p>
                  )}
                  <p>{t.doubtfulHint}</p>
                </div>
              )}
              <div className={`channel-action-card ${selectedLeadMode}`}>
                <header>
                  <small>{locale === "ru" ? "Сценарий работы" : "Recommended workflow"}</small>
                  <span>
                    {supplySide
                      ? t.affiliateNetworkMode
                      : selectedLeadMode === "free_listing"
                      ? locale === "ru" ? "Самостоятельное размещение" : "Self-service listing"
                      : selectedLeadMode === "paid_placement"
                        ? locale === "ru" ? "Платное размещение" : "Paid placement"
                        : locale === "ru" ? "Аутрич" : "Outreach"}
                  </span>
                </header>
                {selectedLead.nextAction && <p>{selectedLead.nextAction}</p>}
                {affiliateNetwork && (
                  <div className="affiliate-hint">
                    <strong>
                      {t.affiliateHintTitle.replace("{network}", affiliateNetwork)}
                    </strong>
                    <p>{t.affiliateHintText}</p>
                  </div>
                )}
                {supplySide ? (
                  <>
                    <dl>
                      <div><dt>{locale === "ru" ? "Тип" : "Type"}</dt><dd>{t.opportunityAffiliateNetwork}</dd></div>
                      <div><dt>{locale === "ru" ? "Способ" : "Method"}</dt><dd>{t.affiliateNetworkMethod}</dd></div>
                      <div><dt>{locale === "ru" ? "Условия" : "Terms"}</dt><dd>{selectedLead.pricingSummary || (locale === "ru" ? "Не опубликованы" : "Not published")}</dd></div>
                    </dl>
                    <a className="channel-primary-action" href={selectedLead.registrationUrl || selectedLead.actionUrl || selectedLead.url} target="_blank" rel="noreferrer">
                      {t.affiliateNetworkOpen}
                    </a>
                  </>
                ) : null}
                {!supplySide && selectedLeadMode === "free_listing" && (
                  <>
                    <dl>
                      <div><dt>{locale === "ru" ? "Стоимость" : "Cost"}</dt><dd>{selectedLead.commercialModel === "free" ? (locale === "ru" ? "Бесплатно" : "Free") : selectedLead.pricingSummary || (locale === "ru" ? "Не опубликована" : "Not published")}</dd></div>
                      <div><dt>{locale === "ru" ? "Способ" : "Method"}</dt><dd>{locale === "ru" ? "Регистрация или подача заявки" : "Registration or submission"}</dd></div>
                      <div><dt>{locale === "ru" ? "Требования" : "Requirements"}</dt><dd>{selectedLead.placementRequirements || (locale === "ru" ? "Не опубликованы" : "Not published")}</dd></div>
                      <div><dt>{locale === "ru" ? "Условия" : "Terms"}</dt><dd>{selectedLead.usageTerms || (locale === "ru" ? "Не опубликованы" : "Not published")}</dd></div>
                    </dl>
                    <a className="channel-primary-action" href={selectedLead.registrationUrl || selectedLead.actionUrl || selectedLead.url} target="_blank" rel="noreferrer">
                      {locale === "ru" ? "Перейти к регистрации" : "Open registration"}
                    </a>
                  </>
                )}
                {!supplySide && selectedLeadMode === "paid_placement" && (
                  <>
                    <dl>
                      <div><dt>{locale === "ru" ? "Тарифы" : "Pricing"}</dt><dd>{selectedLead.pricingSummary || (locale === "ru" ? "Публичная цена не найдена — запросите media kit" : "No public price found — request a media kit")}</dd></div>
                      <div><dt>{locale === "ru" ? "Формат" : "Format"}</dt><dd>{selectedLead.placementRequirements || selectedLead.channelType}</dd></div>
                      <div><dt>{locale === "ru" ? "Условия" : "Terms"}</dt><dd>{selectedLead.usageTerms || (locale === "ru" ? "Уточнить у площадки" : "Confirm with the publisher")}</dd></div>
                    </dl>
                    <a className="channel-primary-action" href={selectedLead.actionUrl || selectedLead.url} target="_blank" rel="noreferrer">
                      {selectedLead.pricingSummary ? (locale === "ru" ? "Посмотреть размещение" : "View placement") : (locale === "ru" ? "Запросить media kit" : "Request media kit")}
                    </a>
                  </>
                )}
                {!supplySide && selectedLeadMode === "outreach" && (
                  <>
                    <dl>
                      <div><dt>{locale === "ru" ? "Контакт" : "Contact"}</dt><dd>{selectedLead.contact || selectedLead.contactRole || (locale === "ru" ? "Ещё не найден" : "Not found yet")}</dd></div>
                      <div><dt>Email</dt><dd>{selectedLead.email || (locale === "ru" ? "Требует поиска" : "Needs research")}</dd></div>
                      <div><dt>Telegram / LinkedIn</dt><dd>{selectedLead.telegram || selectedLead.linkedin || (locale === "ru" ? "Требует поиска" : "Needs research")}</dd></div>
                    </dl>
                    {/* The way in is the network: registering there is the
                        primary action, and the contact check is shown disabled
                        WITH its reason rather than quietly hidden. */}
                    {contactRoute === "network" ? (
                      <>
                        <a
                          className="channel-primary-action"
                          href={networkRoute?.url || selectedLead.actionUrl || selectedLead.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t.routeNetworkAction.replace(
                            "{domain}",
                            networkRoute?.domain || networkRoute?.network || selectedLead.domain,
                          )}
                        </a>
                        <button className="outline" disabled title={t.routeNetworkEnrichDisabled}>
                          {locale === "ru" ? "Найти контакт" : "Find contact"}
                        </button>
                        <small className="action-reason">{t.routeNetworkEnrichDisabled}</small>
                      </>
                    ) : contactRoute === "none" ? (
                      // Checked, no contact, no network: the honest primary
                      // action is to close the lead, not to hunt again.
                      <>
                        <button
                          className="channel-primary-action"
                          onClick={() => updateLeadStatus(selectedLead.id, "rejected")}
                        >
                          {t.reject}
                        </button>
                        <button
                          className="outline"
                          onClick={() => enrichContact(selectedLead)}
                          disabled={busy === "enrich"}
                        >
                          {t.routeRecheck}
                        </button>
                        <small className="action-reason">{t.routeNoneEnrichHint}</small>
                      </>
                    ) : (
                      <button className="channel-primary-action" onClick={() => selectedLead.email || selectedLead.telegram || selectedLead.linkedin ? updateLeadStatus(selectedLead.id, "approved") : enrichContact(selectedLead)} disabled={busy === "enrich" || busy === "outreach"}>
                        {selectedLead.email || selectedLead.telegram || selectedLead.linkedin
                          ? locale === "ru" ? "Подготовить рассылку" : "Prepare outreach"
                          : locale === "ru" ? "Найти контакт" : "Find contact"}
                      </button>
                    )}
                  </>
                )}
              </div>
              {(selectedLeadMode === "free_listing" ||
                selectedLeadMode === "paid_placement") && (
                <div className="placement-tracking" id="placement-tracking">
                  <small>{t.placementTitle}</small>
                  <p className="placement-hint">{t.placementHint}</p>
                  <div className="placement-status" role="group" aria-label={t.placementTitle}>
                    {([
                      ["to_submit", t.placementToSubmit],
                      ["submitted", t.placementSubmitted],
                      ["published", t.placementPublished],
                      ["rejected", t.placementRejected],
                    ] as Array<[PlacementStatus, string]>).map(([status, label]) => (
                      <button
                        key={status}
                        className={placementStatus === status ? "active" : ""}
                        onClick={() =>
                          placementStatus !== status &&
                          updateLeadPlacement(selectedLead.id, {
                            placementStatus: status,
                          })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {placementStatus === "submitted" && submittedDays !== null && (
                    <p className="placement-age">
                      {submittedDays === 0
                        ? t.placementSubmittedToday
                        : t.placementSubmittedDaysAgo.replace(
                            "{days}",
                            String(submittedDays),
                          )}
                      {submittedDays > placementCheckAfterDays && (
                        <em> · {t.placementCheckHint}</em>
                      )}
                    </p>
                  )}
                  {placementStatus === "published" && (
                    <label className="placement-url">
                      <span>{t.placementUrlLabel}</span>
                      <input
                        key={selectedLead.id}
                        type="url"
                        defaultValue={selectedLead.placementUrl || ""}
                        placeholder={t.placementUrlPlaceholder}
                        onBlur={(event) => {
                          const value = event.target.value.trim();
                          if (value !== (selectedLead.placementUrl || "")) {
                            void updateLeadPlacement(selectedLead.id, {
                              placementUrl: value,
                            });
                          }
                        }}
                      />
                    </label>
                  )}
                  <button
                    className="outline copy-utm"
                    onClick={() => copyUtmLink(selectedLead)}
                  >
                    {t.utmCopy}
                  </button>
                </div>
              )}
              {hasTeam && (
                <label className="lead-assignee">
                  <span>{t.assignee}</span>
                  <select
                    value={selectedLead.assignedUserId || ""}
                    onChange={(event) =>
                      void assignLead(selectedLead.id, event.target.value)
                    }
                  >
                    <option value="">{t.unassigned}</option>
                    {members.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.name || member.email}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <dl className="channel-facts"><div><dt>{locale === "ru" ? "Тип" : "Type"}</dt><dd>{selectedLead.channelType}</dd></div><div><dt>{locale === "ru" ? "Источник" : "Source"}</dt><dd>{selectedLead.source}</dd></div></dl>
              {watchLine(selectedLead, t) && (
                <p className="watch-line">{watchLine(selectedLead, t)}</p>
              )}
              {/* A result panel, not a second action: the check itself is
                  started from «Сценарий работы» above. It answers when the
                  contact was last checked, what was found, why it failed and
                  which network is the way in. */}
              {selectedLeadMode === "outreach" && (
              <div className={`contact-proof ${contactStatusValue}`}>
                <div>
                  <small>{t.contactPanelTitle}</small>
                  <strong>{locale === "ru" ? {
                    not_checked: "Ещё не проверен",
                    verified_public: "Подтверждён официальным источником",
                    found_unverified: "Найден, но требует ручной проверки",
                    not_found: "Публичный контакт не найден",
                    check_failed: "Проверка не завершилась — ответ модели не прочитан",
                  }[contactStatusValue] : {
                    not_checked: "Not checked yet",
                    verified_public: "Verified by an official source",
                    found_unverified: "Found, manual verification required",
                    not_found: "No public contact found",
                    check_failed: "The check did not finish — the model answer could not be read",
                  }[contactStatusValue]}</strong>
                  <p className="contact-checked-at">
                    {contactCheckedDays === null
                      ? t.contactPanelNever
                      : contactCheckedDays === 0
                        ? t.contactPanelCheckedToday
                        : t.contactPanelCheckedDaysAgo.replace(
                            "{days}",
                            String(contactCheckedDays),
                          )}
                  </p>
                  {contactStatusValue === "check_failed" ? (
                    <p className="contact-failure">
                      <em>{t.contactPanelFailure}:</em> {t.contactPanelFailureText}
                    </p>
                  ) : contactRoute === "none" ? (
                    <p>{t.contactPanelNotFoundText}</p>
                  ) : null}
                  {(selectedLead.email ||
                    selectedLead.telegram ||
                    selectedLead.linkedin ||
                    selectedLead.contactRole) && (
                    <dl className="contact-found">
                      {selectedLead.email && (
                        <div><dt>Email</dt><dd>{selectedLead.email}</dd></div>
                      )}
                      {(selectedLead.telegram || selectedLead.linkedin) && (
                        <div><dt>Telegram / LinkedIn</dt><dd>{selectedLead.telegram || selectedLead.linkedin}</dd></div>
                      )}
                      {selectedLead.contactRole && (
                        <div><dt>{t.contactPanelRole}</dt><dd>{selectedLead.contactRole}</dd></div>
                      )}
                    </dl>
                  )}
                  {affiliateNetwork && (
                    <p className="contact-network-hint">
                      {t.affiliateHintTitle.replace("{network}", affiliateNetwork)}
                    </p>
                  )}
                  {selectedLead.contactEvidence && !affiliateNetwork && (
                    <p>{selectedLead.contactEvidence}</p>
                  )}
                  {selectedLead.contactSourceUrl && <a href={selectedLead.contactSourceUrl} target="_blank" rel="noreferrer">{t.contactPanelSource}</a>}
                  <button
                    type="button"
                    className="contact-recheck"
                    onClick={() => enrichContact(selectedLead)}
                    disabled={busy === "enrich"}
                  >
                    {busy === "enrich"
                      ? locale === "ru" ? "Ищу и проверяю…" : "Finding and checking…"
                      : t.routeRecheck}
                  </button>
                </div>
                <b>{selectedLead.contactConfidence || 0}%</b>
              </div>
              )}
              <div className="decision"><button onClick={() => updateLeadStatus(selectedLead.id, "rejected")}>{t.reject}</button><button className="dark" onClick={() => updateLeadStatus(selectedLead.id, "approved")}>{selectedLead.status === "approved" ? `✓ ${t.approved}` : t.approve}</button></div>
              <p className="decision-hint">{selectedLead.status === "approved" ? t.approvedHint : t.approveHint}</p>
              <CommentsBlock
                key={selectedLead.id}
                t={t}
                locale={locale}
                comments={comments}
                loading={commentsLoading}
                busy={busy}
                currentUserId={currentUserId}
                isOwner={isOwner}
                addComment={addComment}
                deleteComment={deleteComment}
              />
            </> : <div className="empty compact"><span>←</span><p>{t.emptyLeads}</p></div>}
          </aside>
        </section>
  );
}
