"use client";

import Link from "next/link";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { buildUtmLink } from "../lib/utm.mjs";
import { LOCALE_COOKIE, localeCookie } from "../lib/locale-cookie.mjs";
import { resolveOutreachLocale } from "../lib/outreach-language";
import { isPlanId, planCatalog, type PlanId } from "../lib/plans";
import {
  addLeadCommentApi,
  advancePipelineApi,
  analyzeProductApi,
  createMessageApi,
  createOutreachSequenceApi,
  checkRepliesApi,
  createTemplateApi,
  deleteLeadCommentApi,
  deleteMessageApi,
  deleteTemplateApi,
  fetchLeadComments,
  fetchTeam,
  fetchTemplates,
  updateTemplateApi,
  deleteSessionApi,
  discoverApi,
  enrichContactApi,
  fetchAgentSchedule,
  fetchDigestSettings,
  fetchIntegrations,
  fetchOutreachSequences,
  fetchPipelineRun,
  fetchProspects,
  fetchTasks,
  generateOutreachApi,
  inviteMemberApi,
  loadOrNull,
  markProductSeenApi,
  prefillProductApi,
  removeMemberApi,
  revokeInviteApi,
  runAgentApi,
  runLifecycleApi,
  saveAgentScheduleApi,
  saveDigestSettingsApi,
  saveIntegrationApi,
  saveProductApi,
  saveProductMonitoringApi,
  saveProspectsApi,
  sendDigestNowApi,
  sendEmailApi,
  startCheckoutApi,
  setLocaleApi,
  runCompetitorGapApi,
  startPipelineApi,
  updateOutreachSequenceApi,
  updateProspectApi,
  updateTaskApi,
} from "./api-client";
import { words, type Locale } from "./i18n";
import {
  deliveryFailureMessage,
  deliveryFailureNeedsReconnect,
} from "./gmail-failure";
import { BrandMark } from "../components/brand-mark";
import {
  blankProduct,
  engagementModeForLead,
  leadsPerPage,
  mergePrefillFields,
  type AgentData,
  type BillingData,
  type BusyState,
  type DigestData,
  type IntegrationData,
  type Lead,
  type LeadComment,
  contactRouteForLead,
  type LeadModeFilter,
  type LeadTask,
  type Message,
  type OutreachSequence,
  type OutreachTemplate,
  type PipelineRun,
  type PlacementStatus,
  type PrefillFields,
  type Product,
  type ProspectStage,
  type SequenceStep,
  type SessionUser,
  type TeamData,
} from "./types";
import {
  createInitialWorkspaceState,
  emptyLeadCounts,
  emptyPlacementCounts,
  leadModeFilters,
  workspaceReducer,
} from "./workspace-state";
import AgentSection from "./sections/agent-section";
import BillingSection from "./sections/billing-section";
import Composer from "./sections/composer";
import ContactsSection from "./sections/contacts-section";
import IntegrationsSection from "./sections/integrations-section";
import LaunchChecklist from "./sections/launch-checklist";
import LeadsTable from "./sections/leads-table";
import NewProductForm from "./sections/new-product-form";
import OverviewMetrics from "./sections/overview-metrics";
import RunProgress from "./sections/run-progress";
import ProductPanel from "./sections/product-panel";
import QueueSection from "./sections/queue-section";
import ResultsSection from "./sections/results-section";
import SourcesSection from "./sections/sources-section";
import TeamSection from "./sections/team-section";
import TodaySection from "./sections/today-section";

export type DashboardView =
  | "products"
  | "channels"
  | "contacts"
  | "queue"
  | "agent"
  | "integrations"
  | "billing"
  | "results";

type ToastItem = {
  id: number;
  text: string;
  type: "success" | "error";
  /** An optional way to finish what the toast is reporting. */
  action?: { href: string; label: string };
};

const localeStorageKey = "chanlyst.locale";

// The channel workflow and the product card each live on their own route.
const channelsPath = "/dashboard/channels";
const queuePath = "/dashboard/queue";
const productsPath = "/dashboard/products";

// In-page anchors each route owns. A hash outside its own list is ignored, so
// a cross-page jump has to navigate to the owning route first.
const sectionIdsByView: Partial<Record<DashboardView, string[]>> = {
  products: ["products", "product-card", "checklist"],
  channels: ["channels", "found", "placement-tracking"],
  contacts: ["contacts", "composer", "templates", "sequences"],
  queue: ["queue", "composer", "templates", "sequences", "sequences-list"],
};

function scrollToSection(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Scroll to a section that may not exist yet: the leads page and the lead card
 * inside it mount only once their request resolves, so a deep link is retried
 * for a couple of seconds instead of landing on the top of the page. Returns a
 * canceller for the pending retry.
 */
function scrollToSectionWhenReady(id: string, attempts = 20) {
  let timer = 0;
  let left = attempts;
  let lastTop = Number.NaN;
  const tick = () => {
    const node = document.getElementById(id);
    if (node) {
      const top = Math.round(node.getBoundingClientRect().top);
      // Content arriving below can cancel an in-flight smooth scroll, so the
      // call is repeated until the section stops moving.
      if (top === lastTop) return;
      lastTop = top;
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (--left > 0) timer = window.setTimeout(tick, 100);
  };
  tick();
  return () => window.clearTimeout(timer);
}

// Replace the known template variables with lead/product data; anything else
// (unknown variables, stray braces) stays literally in the text.
function fillTemplateVariables(
  text: string,
  vars: { company: string; contact: string; product: string; url: string },
) {
  return text.replace(
    /\{\{(company|contact|product|url)\}\}/g,
    (_match, key: keyof typeof vars) => vars[key],
  );
}

export default function Home({
  view = "products",
  initialLocale = "en",
  initialProductId = "",
}: {
  view?: DashboardView;
  /**
   * Read from the cookie on the server, so the first paint is already right.
   * English by default: the public site and the outreach drafts are already
   * English-first, and the app used to be the one surface that greeted a new
   * account in Russian.
   */
  initialLocale?: Locale;
  /** Product imported from the anonymous landing-page preview. */
  initialProductId?: string;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  // Channels written in the language the workspace no longer uses. Switching
  // cannot rewrite what was already generated, so the count is shown rather
  // than left for the user to meet one card at a time.
  const [staleContent, setStaleContent] = useState(0);
  const t = words[locale];
  // The coupled product/lead workspace lives in one reducer so transitions
  // that used to span many setState calls are applied atomically.
  const [workspace, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    createInitialWorkspaceState,
  );
  const {
    products,
    activeId,
    editing,
    leads,
    leadTotal,
    leadCounts,
    placementCounts,
    outcomeLeads,
    newCount,
    loadedLeadKey,
    leadRefresh,
    discoveredProducts,
    leadPage,
    leadModeFilter,
    assignedFilter,
    selectedLeadId,
  } = workspace;
  const [newOpen, setNewOpen] = useState(false);
  const [sources, setSources] = useState<string[]>([
    "web",
    "reviews",
    "creators",
    "communities",
  ]);
  const [channel, setChannel] = useState<"email" | "telegram" | "linkedin">("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<OutreachTemplate[]>([]);
  // The template applied to the current subject/body. It survives manual
  // edits and is cleared when another template or lead is chosen.
  const [appliedTemplateId, setAppliedTemplateId] = useState("");
  const [integrationData, setIntegrationData] = useState<IntegrationData>({});
  const [sessionUser, setSessionUser] = useState<SessionUser>({});
  // The workspace the session belongs to: the launch checklist remembers its
  // completion per workspace, so the id has to be known on the client.
  const [workspaceId, setWorkspaceId] = useState("");
  // Whether this workspace has at least one saved product. An empty workspace
  // still renders a local starter draft, so the products list alone cannot
  // answer the checklist's first step.
  const [productSaved, setProductSaved] = useState(false);
  const [billingData, setBillingData] = useState<BillingData>({});
  const [agentData, setAgentData] = useState<AgentData>({});
  const [digestData, setDigestData] = useState<DigestData>({});
  const [teamData, setTeamData] = useState<TeamData>({});
  // The lifecycle queue and the task the user is currently executing. The
  // focused task carries its own lead, so acting on a task never depends on
  // that lead happening to be on the visible page of the channel list.
  const [tasks, setTasks] = useState<LeadTask[]>([]);
  const [taskFocus, setTaskFocus] = useState<{ taskId: string; lead: Lead } | null>(
    null,
  );
  const [comments, setComments] = useState<LeadComment[]>([]);
  // Comments load lazily per selected lead; loading is derived from the id.
  const [commentsLeadId, setCommentsLeadId] = useState("");
  // «Подготовить всё»: the run the progress card renders, plus a guard so at
  // most one slice is in flight from this tab at a time.
  const [pipelineRun, setPipelineRun] = useState<PipelineRun | null>(null);
  const pipelineBusyRef = useRef(false);
  const [sequenceSteps, setSequenceSteps] = useState<SequenceStep[]>([]);
  // The sequence draft saved from the composer, so it can be started in place.
  const [savedSequence, setSavedSequence] = useState<{
    id: string;
    company: string;
  } | null>(null);
  const [outreachSequences, setOutreachSequences] = useState<OutreachSequence[]>([]);
  const [busy, setBusy] = useState<BusyState>("");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);
  const discoveringRef = useRef(false);
  const sendingRef = useRef(false);
  const localeRef = useRef(locale);
  const editingRef = useRef(editing);
  const selectedLeadIdRef = useRef(selectedLeadId);
  const urlReadyRef = useRef(false);
  // Mirrors taskFocus for the prospects effect, which must not overwrite a
  // draft prepared for a task when the product's first page arrives.
  const taskFocusRef = useRef("");
  // The product whose leads were last marked as seen: mark-seen fires once
  // per product selection, not on every page/filter change.
  const markSeenProductRef = useRef("");

  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  useEffect(() => {
    selectedLeadIdRef.current = selectedLeadId;
  }, [selectedLeadId]);

  // `editing` is a blank product until the user adds a real one, so an empty
  // portfolio renders the same shell with empty counters instead of crashing
  // on products[0]. The dashboard used to be handed a demo product here, which
  // is why nothing downstream ever had to consider "no products yet".
  const activeProduct =
    products.find((product) => product.id === activeId) || products[0] || editing;
  // Filtering and pagination happen server-side: `leads` is the current page.
  const pageLead = leads.find((lead) => lead.id === selectedLeadId) || leads[0];
  // A task the user started wins over the page selection until it is finished
  // or another lead is clicked.
  const selectedLead = taskFocus?.lead || pageLead;
  const selectedLeadMode = selectedLead
    ? engagementModeForLead(selectedLead)
    : undefined;
  const leadPageCount = Math.max(1, Math.ceil(leadTotal / leadsPerPage));
  const effectiveLeadPage = Math.min(leadPage, leadPageCount);
  const hasDiscovered = Boolean(discoveredProducts[activeId]) || leadCounts.all > 0;
  // Loading is derived: the skeleton shows until the response for the current
  // product/kind/page/filter combination has arrived. The fetch below uses this
  // very constant rather than assembling its own — when the two were written
  // out separately they drifted, and the list never left its skeleton.
  // Outreach reads contacts rather than channels: it is the page where the
  // direct-buyer companies a run finds are shown, and without this they land
  // in a table nothing renders.
  const leadRecordKind =
    view === "contacts" || view === "queue" ? "contact" : "channel";
  const leadQueryKey = `${activeId}|${leadRecordKind}|${leadPage}|${leadModeFilter}|${assignedFilter}|${leadRefresh}`;
  const leadsLoading = loadedLeadKey !== leadQueryKey;
  const connected = integrationData.integrations || {};
  const configured = integrationData.configuration || {};
  const currentPlanId: PlanId =
    billingData.plan && isPlanId(billingData.plan) ? billingData.plan : "starter";
  const currentPlan = planCatalog[currentPlanId];

  // Who the draft is signed by. Read through a ref for the same reason as the
  // product and the locale: prepareMessage has to keep a stable identity.
  //
  // It used to be one hard-coded first name, which is correct for exactly one
  // installation. Anyone else running this signed their outreach with a
  // stranger's name.
  const signerRef = useRef("");
  useEffect(() => {
    // The name, never the address: a signature is how the reader knows who
    // wrote to them, and the address is already in the From line.
    signerRef.current = (sessionUser.name || "").trim();
  }, [sessionUser.name]);

  // prepareMessage reads the editing product and locale through refs so its
  // identity stays stable and effects can list it as a dependency safely.
  const prepareMessage = useCallback(
    (lead: Lead, product?: Product, nextLocale?: Locale) => {
      const messageProduct = product ?? editingRef.current;
      const messageLocale = resolveOutreachLocale(
        messageProduct,
        nextLocale ?? localeRef.current,
      );
      const firstName = lead.contact?.split(" ")[0] || "";
      const signer = signerRef.current;
      // A generated draft replaces the template text, so attribution resets.
      setAppliedTemplateId("");
      setSubject(
        messageLocale === "ru"
          ? `Идея привлечения платящих клиентов для ${lead.company}`
          : `Paid-customer partnership idea for ${lead.company}`,
      );
      setBody(
        messageLocale === "ru"
          ? `${firstName ? `${firstName},` : "Здравствуйте!"}\n\nЯ изучил ${lead.company}: ${lead.reason}\n\n${messageProduct.name} — ${messageProduct.analysis.summary || messageProduct.description}\n\nПредлагаю ${messageProduct.partnerTerms || messageProduct.analysis.offer || "начать с небольшого тестового размещения с измеримым результатом"}. Результат измеряем по событию: ${messageProduct.conversionEvent || "подтверждённая оплата"}.\n\nМогу прислать короткий вариант размещения и тестовую ссылку?${signer ? `\n\n${signer}` : ""}`
          : `${firstName ? `Hi ${firstName},` : "Hello,"}\n\nI’m reaching out with a partnership idea for ${lead.company}. ${messageProduct.name} is looking for relevant channels that can bring paying customers.\n\nWe can start with a small, measurable test and attribute the result to confirmed paid conversions.\n\nMay I send a short placement draft and a test link?${signer ? `\n\n${signer}` : ""}`,
      );
    },
    [],
  );

  // Accounts that picked a language before the cookie existed have it only in
  // localStorage, where the server cannot see it. Copy it across once, on
  // mount rather than after the data loads, so it costs a frame and not a
  // second — and never runs again for that browser.
  useEffect(() => {
    if (document.cookie.includes(`${LOCALE_COOKIE}=`)) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(localeStorageKey);
    } catch {
      return;
    }
    if (stored !== "ru" && stored !== "en") return;
    document.cookie = localeCookie(stored);
    setLocale(stored);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadOrNull<{ products?: Product[] }>("/api/products"),
      loadOrNull<{ messages?: Message[] }>("/api/messages"),
      loadOrNull<IntegrationData>("/api/integrations"),
      loadOrNull<{ user?: SessionUser; workspaceId?: string }>(
        "/api/auth/session",
      ),
      loadOrNull<BillingData>("/api/billing"),
      loadOrNull<AgentData>("/api/agent/schedule"),
      loadOrNull<{ sequences?: OutreachSequence[] }>("/api/outreach-sequences"),
      loadOrNull<DigestData>("/api/digest/settings"),
      loadOrNull<{ templates?: OutreachTemplate[] }>("/api/templates?archived=1"),
      loadOrNull<TeamData>("/api/workspace/members"),
      loadOrNull<{ tasks?: LeadTask[] }>("/api/tasks"),
    ]).then(([productData, messageData, integrations, sessionData, billing, agent, outreach, digest, templateData, team, taskData]) => {
      if (cancelled) return;
      const params = new URLSearchParams(window.location.search);
      if (productData) {
        if (productData.products?.length) {
          setProductSaved(true);
          const requestedProductId = params.get("product") || initialProductId;
          const requested = productData.products.find(
            (product) => product.id === requestedProductId,
          );
          const initial = requested || productData.products[0];
          dispatch({
            type: "productsLoaded",
            products: productData.products,
            initial,
          });
        } else {
          // A workspace with no products shows an empty portfolio and the
          // invitation to add one — never a fixture standing in for the
          // user's own product.
          dispatch({
            type: "productsLoaded",
            products: [],
            initial: blankProduct(),
          });
        }
      }
      const requestedFilter = leadModeFilters.find(
        (item) => item === params.get("filter"),
      );
      if (requestedFilter) dispatch({ type: "filterRestored", filter: requestedFilter });
      urlReadyRef.current = true;
      if (messageData?.messages) setMessages(messageData.messages);
      if (integrations) setIntegrationData(integrations);
      if (sessionData?.user) setSessionUser(sessionData.user);
      if (sessionData?.workspaceId) setWorkspaceId(sessionData.workspaceId);
      if (billing) setBillingData(billing);
      if (agent) setAgentData(agent);
      if (outreach) setOutreachSequences(outreach.sequences || []);
      if (digest) setDigestData(digest);
      if (templateData?.templates) setTemplates(templateData.templates);
      if (team) setTeamData(team);
      if (taskData?.tasks) setTasks(taskData.tasks);
      // A task started from the list on Results navigates here carrying its
      // id; the focus it set in memory is re-established once the tasks
      // arrive. Where "here" is depends on the task: Outreach for one that
      // ends in a message, Channels for one that ends in a placement check.
      const requestedTask = params.get("task");
      const focused = requestedTask
        ? (taskData?.tasks || []).find((item) => item.id === requestedTask)
        : undefined;
      if (focused) {
        taskFocusRef.current = focused.id;
        setTaskFocus({ taskId: focused.id, lead: focused.lead });
        if (focused.type === "follow_up" || focused.type === "revive") {
          prepareMessage(
            focused.lead,
            productData?.products?.find((item) => item.id === focused.productId),
          );
        }
        // The hash effect above scrolls to the block the task points at once
        // the lead card it lives in has mounted.
      }
      if (new URLSearchParams(window.location.search).get("checkout") === "success") {
        notify(words[localeRef.current].paymentSuccess);
        window.history.replaceState({}, "", "/dashboard");
      }
    });
    return () => {
      cancelled = true;
    };
    // prepareMessage is stable, so this still runs exactly once on mount.
  }, [initialProductId, prepareMessage]);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    const recordKind = leadRecordKind;
    const queryKey = leadQueryKey;
    fetchProspects(activeId, {
      signal: controller.signal,
      limit: leadsPerPage,
      offset: (leadPage - 1) * leadsPerPage,
      mode:
        leadModeFilter === "all" ||
        leadModeFilter === "network_route" ||
        leadModeFilter === "doubtful"
          ? undefined
          : leadModeFilter,
      route: leadModeFilter === "network_route" ? "network" : undefined,
      relevance: leadModeFilter === "doubtful" ? "doubtful" : undefined,
      assigned: assignedFilter === "mine" ? "me" : undefined,
      kind: recordKind,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        const found = (data.prospects || []) as Lead[];
        const total = data.total ?? found.length;
        // The reducer applies the page atomically: it also clamps the page
        // number and repairs the selection using the same conditions below.
        dispatch({
          type: "leadsPageLoaded",
          leads: found,
          total,
          counts: data.counts || { ...emptyLeadCounts, all: total },
          placementCounts: data.placementCounts || emptyPlacementCounts,
          outcomeLeads: (data.outcomeLeads || []) as Lead[],
          newCount: Number(data.newCount || 0),
          requestKey: queryKey,
        });
        // The user is now looking at this product's leads: record the visit
        // once per product selection. The current response keeps showing the
        // "N new" line; the next refetch (already past the new timestamp)
        // clears it.
        if (markSeenProductRef.current !== activeId) {
          markSeenProductRef.current = activeId;
          void markProductSeenApi(activeId).then((ok) => {
            if (ok) dispatch({ type: "productSeen", productId: activeId });
          });
        }
        const maxPage = Math.max(1, Math.ceil(total / leadsPerPage));
        if (leadPage > maxPage) return;
        // A draft prepared for a started task must survive the product switch
        // that the task itself triggered.
        if (taskFocusRef.current) return;
        if (!found.some((lead) => lead.id === selectedLeadIdRef.current)) {
          if (found[0]) prepareMessage(found[0]);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          dispatch({ type: "leadsPageFailed", requestKey: queryKey });
      });
    return () => controller.abort();
  }, [activeId, leadQueryKey, leadRecordKind, leadPage, prepareMessage]);

  // The «Подготовить всё» run of the selected product: loaded once per
  // product, then kept fresh by the polling effect below.
  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    fetchPipelineRun(activeId, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setPipelineRun(data.run || null);
      })
      .catch(() => {
        // A missing run is simply "nothing prepared yet".
      });
    return () => controller.abort();
  }, [activeId]);

  // While a run is active the dashboard both polls it and pushes it forward
  // one slice at a time, so the user does not wait for the two-minute cron.
  // Polling stops the moment the run reaches a terminal (or paused) state.
  // A run loaded for another product must never be rendered against the one
  // now selected, so the card is derived rather than reset in an effect.
  const activePipelineRun =
    pipelineRun && pipelineRun.productId === activeId ? pipelineRun : null;
  const pipelineActive =
    activePipelineRun?.status === "queued" ||
    activePipelineRun?.status === "running";
  useEffect(() => {
    if (!pipelineActive || !activeId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || pipelineBusyRef.current) return;
      pipelineBusyRef.current = true;
      try {
        const { ok, result } = await advancePipelineApi(activeId);
        if (!cancelled && ok && result.run) setPipelineRun(result.run);
      } catch {
        // A failed tick is retried on the next interval; the run itself keeps
        // its own retry budget on the server.
      } finally {
        pipelineBusyRef.current = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pipelineActive, activeId]);

  // A finished run means new channels, contacts, messages and sequences are
  // on the server: refresh the surfaces that render them.
  const pipelineFinishedAt = pipelineRun?.finishedAt || "";
  useEffect(() => {
    if (!pipelineFinishedAt) return;
    refreshLeads();
    void refreshOutreachSequences();
    void refreshTemplates();
    void loadOrNull<{ messages?: Message[] }>("/api/messages").then((data) => {
      if (data?.messages) setMessages(data.messages);
    });
    // Keyed by the run's finish timestamp, so it fires exactly once per run.
  }, [pipelineFinishedAt]);

  // Lazily load the comment thread for the selected lead.
  const selectedLeadIdForComments = selectedLead?.id || "";
  useEffect(() => {
    // Stale comments are hidden by the derived loading flag (the thread id
    // no longer matches), so nothing needs to be cleared synchronously here.
    if (!selectedLeadIdForComments) return;
    const controller = new AbortController();
    fetchLeadComments(selectedLeadIdForComments, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setComments(data.comments || []);
        setCommentsLeadId(selectedLeadIdForComments);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCommentsLeadId(selectedLeadIdForComments);
      });
    return () => controller.abort();
  }, [selectedLeadIdForComments]);

  // Keep the selected product and lead filter shareable via the URL without
  // triggering router navigations.
  // The selected product stays shareable on both routes that use it; the lead
  // filter only exists on the channels page, so only that route syncs it.
  useEffect(() => {
    if (!urlReadyRef.current) return;
    if (view !== "channels" && view !== "contacts" && view !== "products") return;
    const url = new URL(window.location.href);
    url.searchParams.set("product", activeId);
    if ((view === "channels" || view === "contacts") && leadModeFilter !== "all") {
      url.searchParams.set("filter", leadModeFilter);
    } else {
      url.searchParams.delete("filter");
    }
    // The task hand-off parameter is consumed on mount, not carried onwards.
    url.searchParams.delete("task");
    window.history.replaceState({}, "", url);
  }, [activeId, leadModeFilter, view]);

  // Landing on a route with a section hash (deep link or a click from another
  // page): the browser's native jump fires before the async content settles,
  // so one explicit scroll after render lands on the right section.
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (!(sectionIdsByView[view] || []).includes(target)) return;
    // Keep the browser from restoring a stale scroll position on top of ours.
    window.history.scrollRestoration = "manual";
    return scrollToSectionWhenReady(target);
  }, [view]);

  // Sidebar links to sections of the page that is already open: the URL
  // carries ?product=…, so a plain hash anchor would trigger a full navigation
  // (URL mismatch) and an abrupt native jump. Update the hash without the
  // native jump and scroll exactly once instead. From another page the default
  // navigation proceeds and the effect above scrolls after it renders.
  function handleSectionLink(
    event: ReactMouseEvent<HTMLAnchorElement>,
    id: string,
  ) {
    if (!(sectionIdsByView[view] || []).includes(id)) return;
    event.preventDefault();
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.pushState({}, "", url);
    scrollToSection(id);
  }

  function refreshLeads() {
    dispatch({ type: "refreshRequested" });
  }

  function chooseProduct(product: Product) {
    dispatch({ type: "selectProduct", product });
  }

  function clearTaskFocus() {
    taskFocusRef.current = "";
    setTaskFocus(null);
  }

  function chooseLead(lead: Lead) {
    clearTaskFocus();
    dispatch({ type: "leadSelected", id: lead.id });
    if (engagementModeForLead(lead) === "outreach") {
      prepareMessage(lead);
      if (lead.status === "approved") void generateOutreach(lead);
    }
  }

  function chooseLeadModeFilter(nextFilter: LeadModeFilter) {
    // The prospects effect refetches the page and repairs the selection.
    dispatch({ type: "filterChanged", filter: nextFilter });
  }

  function chooseLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    // The cookie is what the server reads on the next navigation; the
    // localStorage copy is kept only so an older tab still agrees.
    document.cookie = localeCookie(nextLocale);
    try {
      window.localStorage.setItem(localeStorageKey, nextLocale);
    } catch {
      // Storage unavailable — the choice simply will not persist.
    }
    // The cookie only paints this browser. Generated text is written in the
    // workspace's language, so the choice has to reach the server too —
    // otherwise a second browser, or the nightly agent, writes in whichever
    // language it happened to assume.
    void setLocaleApi(nextLocale)
      .then((result) => setStaleContent(Number(result.result?.staleChannels) || 0))
      .catch(() => {
        // The interface is already switched; a failed save only means the
        // next run may still use the previous language.
      });
    if (selectedLead) {
      prepareMessage(selectedLead, editing, nextLocale);
      if (
        selectedLead.status === "approved" &&
        engagementModeForLead(selectedLead) === "outreach"
      ) {
        void generateOutreach(selectedLead, channel, nextLocale);
      }
    }
  }

  function chooseChannel(nextChannel: "email" | "telegram" | "linkedin") {
    setChannel(nextChannel);
    if (selectedLead) {
      prepareMessage(selectedLead);
      if (
        selectedLead.status === "approved" &&
        engagementModeForLead(selectedLead) === "outreach"
      ) {
        void generateOutreach(selectedLead, nextChannel);
      }
    }
  }

  async function generateOutreach(
    lead: Lead,
    nextChannel = channel,
    nextLocale = locale,
  ) {
    setBusy("outreach");
    try {
      const { ok, result } = await generateOutreachApi({
        product: editing,
        lead,
        channel: nextChannel,
        locale: nextLocale,
      });
      if (!ok || !result.body) {
        notify(
          result.error === "ai_credits_exhausted"
            ? t.aiCreditsExhausted
            : result.error === "plan_limit_reached"
            ? nextLocale === "ru"
              ? "Месячный лимит AI-запросов исчерпан."
              : "Your monthly AI request limit has been reached."
            : result.error || t.failed,
          "error",
        );
        return;
      }
      // Only into the composer that is actually showing this lead.
      //
      // This writes into shared state, and two callers reach it for a lead
      // nobody is looking at: approving a row generates that row's draft, and
      // clicking through the list quickly leaves an earlier request in flight.
      // Either way the text arrived in a composer aimed at somebody else, and
      // it looks like an ordinary draft — there is nothing on screen to say it
      // was written about a different company. On the live run of 15 August
      // that put a letter about MarketingDB in front of saasconsult.co, which
      // had already had its own letter thirty-three seconds earlier, and left
      // MarketingDB with none.
      if (lead.id === selectedLeadIdRef.current) {
        setAppliedTemplateId("");
        setSubject(result.subject || "");
        setBody(result.body);
      }
      // Returned as well as stored: a caller that wants to queue this draft
      // cannot read it back out of state in the same tick.
      return { subject: result.subject || "", body: result.body };
    } catch {
      notify(t.failed, "error");
    } finally {
      setBusy("");
    }
  }

  /**
   * A failure code, in words, with somewhere to go about it.
   *
   * The send route used to hand its exception straight to the toast, which is
   * how "atob() called with invalid base64-encoded data" ended up in front of
   * a user whose Gmail token had simply expired.
   */
  function sendFailure(code?: string) {
    return {
      text: deliveryFailureMessage(code, locale),
      ...(deliveryFailureNeedsReconnect(code)
        ? {
            action: {
              href: "/dashboard/integrations",
              label: t.gmailReconnectAction,
            },
          }
        : {}),
    };
  }

  function notify(
    text: string,
    type: "success" | "error" = "success",
    action?: { href: string; label: string },
  ) {
    const id = ++toastIdRef.current;
    // Keep at most three toasts visible; the oldest ones are dropped early.
    setToasts((current) => [...current, { id, text, type, action }].slice(-3));
    // A toast that offers an action has to outlast the reflex to ignore it.
    window.setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      action ? 7000 : 3200,
    );
  }

  async function saveAgentSchedule(
    enabled = Boolean(agentData.schedule?.enabled),
    cadence = agentData.schedule?.cadence || "weekly",
  ) {
    setBusy("agent");
    try {
      const { ok, result } = await saveAgentScheduleApi({
        enabled,
        cadence,
        maxResults: agentData.schedule?.maxResults || 12,
        sources,
      });
      if (!ok) {
        notify(
          result.error === "paid_plan_required"
            ? locale === "ru"
              ? "Фоновое расписание доступно на платном тарифе. Ручной запуск уже работает."
              : "Background scheduling requires a paid plan. Manual runs already work."
            : result.error || t.failed,
          "error",
        );
        return;
      }
      setAgentData(result);
      notify(
        locale === "ru"
          ? enabled
            ? "Расписание фонового агента сохранено."
            : "Фоновый агент приостановлен."
          : enabled
            ? "Background agent schedule saved."
            : "Background agent paused.",
      );
    } finally {
      setBusy("");
    }
  }

  async function runAgentNow() {
    setBusy("agent");
    try {
      const { ok, result } = await runAgentApi();
      if (!ok) {
        notify(result.error || t.failed, "error");
        return;
      }
      const refreshed = await fetchAgentSchedule();
      setAgentData(refreshed);
      if (activeId) {
        dispatch({ type: "agentRunCompleted", productId: activeId });
      }
      notify(
        locale === "ru"
          ? `Агент завершил поиск: найдено возможностей — ${result.opportunitiesFound || 0}.`
          : `Agent finished: ${result.opportunitiesFound || 0} opportunities found.`,
      );
    } finally {
      setBusy("");
    }
  }

  async function saveDigestSettings(changes: {
    enabled?: boolean;
    cadence?: "daily" | "weekly";
    locale?: "ru" | "en";
  }) {
    setBusy("digest");
    try {
      const settings = digestData.settings || {};
      const { ok, result } = await saveDigestSettingsApi({
        enabled: changes.enabled ?? Boolean(settings.enabled),
        cadence: changes.cadence || settings.cadence || "weekly",
        locale: changes.locale || settings.locale || locale,
      });
      if (!ok) {
        notify(result.error || t.failed, "error");
        return;
      }
      setDigestData(result);
      notify(t.digestSaved);
    } finally {
      setBusy("");
    }
  }

  async function sendDigestNow() {
    setBusy("digest");
    try {
      const { ok, result } = await sendDigestNowApi();
      if (!ok) {
        const reason = result.results?.[0]?.status || result.error;
        notify(
          reason === "gmail_not_connected"
            ? t.digestGmailRequired
            : result.results?.[0]?.error || result.error || t.failed,
          "error",
        );
        return;
      }
      const refreshed = await fetchDigestSettings();
      setDigestData(refreshed);
      notify(t.digestSent);
    } finally {
      setBusy("");
    }
  }

  function buildSequence() {
    // A freshly built draft replaces whatever was saved before it.
    setSavedSequence(null);
    const messageLocale = resolveOutreachLocale(editing, locale);
    const baseSubject = subject || (
      messageLocale === "ru"
        ? `Идея для {{company_name}}`
        : `Idea for {{company_name}}`
    );
    const baseBody = body || (
      messageLocale === "ru"
        ? "Здравствуйте, {{first_name}}! Есть короткая идея сотрудничества для {{company_name}}."
        : "Hi {{first_name}}, I have a short partnership idea for {{company_name}}."
    );
    setSequenceSteps([
      { subject: baseSubject, body: baseBody, delayDays: 0 },
      {
        subject: `Re: ${baseSubject}`,
        body: messageLocale === "ru"
          ? "{{first_name}}, добавлю один практический момент: мы можем начать с небольшого теста и измерить результат по подтверждённым оплатам. Прислать короткий план?"
          : "{{first_name}}, one practical addition: we can start with a small test and measure confirmed payments. May I send the short plan?",
        delayDays: 3,
      },
      {
        subject: `Re: ${baseSubject}`,
        body: messageLocale === "ru"
          ? "{{first_name}}, закрываю тему, чтобы не отвлекать. Если привлечение платящих клиентов для {{company_name}} сейчас актуально, я подготовлю конкретный тест без долгих созвонов."
          : "{{first_name}}, I’ll close the loop here. If acquiring paying customers for {{company_name}} is timely, I can prepare a concrete test without a lengthy call.",
        delayDays: 5,
      },
    ]);
    notify(locale === "ru" ? "Цепочка из трёх писем подготовлена." : "Three-email sequence prepared.");
  }

  async function refreshOutreachSequences() {
    const result = await fetchOutreachSequences();
    setOutreachSequences(result.sequences || []);
  }

  // Starts the draft the user has just saved, without making them go and look
  // for it on the queue page.
  async function startSavedSequence() {
    if (!savedSequence) return;
    await updateOutreachSequence(savedSequence.id, "activate");
    setSavedSequence(null);
  }

  async function createOutreachSequence() {
    if (!selectedLead || !sequenceSteps.length) return;
    setBusy("sequence");
    try {
      const { ok, result } = await createOutreachSequenceApi({
        productId: activeProduct.id,
        leadId: selectedLead.id,
        name: `${selectedLead.company} · ${sequenceSteps.length} email`,
        steps: sequenceSteps,
      });
      if (!ok) {
        notify(
          result.error === "lead_approval_required"
            ? locale === "ru"
              ? "Сначала одобрите контакт в списке выше."
              : "Approve the contact in the list above first."
            : result.error === "verified_email_required"
              ? locale === "ru"
                ? "Для цепочки нужен найденный и проверенный email."
                : "A found and verified email is required."
              : result.error || t.failed,
          "error",
        );
        return;
      }
      await refreshOutreachSequences();
      // The confirmation with its own «Запустить» button appears in place, so
      // the user never has to hunt for the draft on another page.
      if (result.id) {
        setSavedSequence({ id: result.id, company: selectedLead.company });
      }
      notify(
        locale === "ru"
          ? "Черновик серии сохранён. Запустить его можно прямо здесь."
          : "Series draft saved. You can start it right here.",
      );
      document.getElementById("sequences")?.scrollIntoView({ behavior: "smooth" });
    } finally {
      setBusy("");
    }
  }

  async function updateOutreachSequence(
    id: string,
    action: "activate" | "pause" | "resume" | "cancel",
  ) {
    setBusy("sequence");
    try {
      const { ok, result } = await updateOutreachSequenceApi(id, action);
      if (!ok) {
        notify(
          sendFailure(result.error).text,
          "error",
          sendFailure(result.error).action,
        );
        return;
      }
      await refreshOutreachSequences();
      notify(
        locale === "ru"
          ? action === "activate" || action === "resume"
            ? "Цепочка запущена."
            : action === "pause"
              ? "Цепочка приостановлена."
              : "Цепочка отменена."
          : action === "activate" || action === "resume"
            ? "Sequence started."
            : action === "pause"
              ? "Sequence paused."
              : "Sequence cancelled.",
      );
    } finally {
      setBusy("");
    }
  }

  async function checkReplies() {
    setBusy("replies");
    try {
      const { ok, result } = await checkRepliesApi();
      if (!ok) {
        notify(
          result.error === "gmail_not_connected"
            ? t.repliesGmailRequired
            : result.error || t.failed,
          "error",
        );
        return;
      }
      const replies = (result.results || []).reduce(
        (sum, item) => sum + Number(item.replies || 0),
        0,
      );
      if (replies > 0) {
        // Stopped sequences and upgraded funnel stages must show up right away.
        await refreshOutreachSequences();
        refreshLeads();
        notify(t.repliesFound.replace("{count}", String(replies)));
      } else {
        notify(t.repliesNone);
      }
    } finally {
      setBusy("");
    }
  }

  // Start executing a task: bring the right lead and the right control into
  // view with everything prepared. Nothing is sent here — the follow-up and
  // revive branches only fill the composer, exactly like approving a lead.
  // The controls live on other routes now, so the task carries its id and
  // product through the URL and the landing page restores the focus.
  function startTask(task: LeadTask) {
    if (task.type === "advance_deal") {
      // The outcome controls live in the results view.
      window.location.assign(
        `/dashboard/results?product=${encodeURIComponent(task.productId)}`,
      );
      return;
    }
    // Monitoring tasks are about a page that changed, so the page itself is
    // the primary action: it opens in a new tab and the lead card is focused
    // underneath, ready for the decision that follows.
    if (
      task.type === "listing_missing" ||
      task.type === "terms_changed" ||
      task.type === "channel_unreachable"
    ) {
      const url =
        task.payload.watchUrl ||
        task.lead.placementUrl ||
        task.lead.registrationUrl ||
        task.lead.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    }
    const product = products.find((item) => item.id === task.productId);
    // A task that ends in a message and a task that ends in a placement check
    // now live on different pages: the composer moved to Outreach, so sending
    // "follow up" to Channels would land on a page that no longer has anywhere
    // to write.
    const writing = task.type === "follow_up" || task.type === "revive";
    const target = writing ? "composer" : "placement-tracking";
    const path = writing ? queuePath : channelsPath;
    const here = writing ? view === "queue" : view === "channels";
    if (!here) {
      window.location.assign(
        `${path}?product=${encodeURIComponent(task.productId)}&task=${encodeURIComponent(task.id)}#${target}`,
      );
      return;
    }
    taskFocusRef.current = task.id;
    setTaskFocus({ taskId: task.id, lead: task.lead });
    if (product && product.id !== activeId) {
      dispatch({ type: "selectProduct", product });
    }
    if (task.type === "follow_up" || task.type === "revive") {
      prepareMessage(task.lead, product);
    }
    // The section may still be mounting after a product switch; the lead card
    // itself is the fallback when the placement block is not rendered.
    window.setTimeout(() => {
      const node =
        document.getElementById(target) ||
        document.getElementById(writing ? "queue" : "channels");
      node?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }

  async function updateTask(
    task: LeadTask,
    action: "done" | "dismiss" | "snooze",
  ) {
    setBusy("tasks");
    try {
      const { ok, result } = await updateTaskApi({
        id: task.id,
        action,
        days: action === "snooze" ? 7 : undefined,
      });
      if (!ok) {
        notify(result.error || t.failed, "error");
        return;
      }
      setTasks((current) => current.filter((item) => item.id !== task.id));
      if (taskFocusRef.current === task.id) clearTaskFocus();
      notify(
        action === "done"
          ? t.todayDone
          : action === "snooze"
            ? t.todaySnoozed
            : t.todayDismissed,
      );
    } finally {
      setBusy("");
    }
  }

  // "Обновить задачи": re-runs the rule engine for this workspace and reloads
  // the list. The engine only prepares and closes tasks.
  async function refreshTasks() {
    setBusy("tasks");
    try {
      const { ok, result } = await runLifecycleApi();
      if (!ok) {
        notify(result.error || t.failed, "error");
        return;
      }
      const data = await fetchTasks();
      setTasks(data.tasks || []);
      notify(t.todayRefreshed);
    } finally {
      setBusy("");
    }
  }

  async function refreshTemplates() {
    const result = await fetchTemplates();
    setTemplates(result.templates || []);
  }

  // Apply a template to the composer: substitute the known variables from the
  // selected lead and active product and remember the id for attribution.
  function applyTemplate(templateId: string) {
    if (!templateId) {
      setAppliedTemplateId("");
      return;
    }
    const template = templates.find((item) => item.id === templateId);
    if (!template || !selectedLead) return;
    const vars = {
      company: selectedLead.company,
      contact: selectedLead.contact?.split(" ")[0] || "",
      product: activeProduct.name,
      url: selectedLead.url,
    };
    setSubject(fillTemplateVariables(template.subject, vars));
    setBody(fillTemplateVariables(template.body, vars));
    setAppliedTemplateId(template.id);
    notify(t.templateApplied);
  }

  // "Save as template" in the composer: store the current subject/body with
  // channel/locale/engagement mode taken from the current context.
  async function saveComposerAsTemplate(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      notify(t.templateNameRequired, "error");
      return false;
    }
    if (!body.trim()) {
      notify(t.templateBodyRequired, "error");
      return false;
    }
    setBusy("template");
    try {
      const { ok, result } = await createTemplateApi({
        name: trimmed,
        channel,
        engagementMode: selectedLeadMode || "",
        locale: resolveOutreachLocale(editing, locale),
        subject: channel === "email" ? subject : "",
        body,
      });
      if (!ok) {
        notify(result.error || t.failed, "error");
        return false;
      }
      if (result.id) setAppliedTemplateId(result.id);
      await refreshTemplates();
      notify(t.templateSaved);
      return true;
    } finally {
      setBusy("");
    }
  }

  async function saveTemplateEdits(payload: {
    id: string;
    name: string;
    subject: string;
    body: string;
  }) {
    setBusy("template");
    try {
      const { ok, result } = await updateTemplateApi(payload);
      if (!ok) {
        notify(result.error || t.failed, "error");
        return false;
      }
      await refreshTemplates();
      notify(t.templateUpdated);
      return true;
    } finally {
      setBusy("");
    }
  }

  async function setTemplateArchived(id: string, archived: boolean) {
    setBusy("template");
    try {
      const { ok, result } = await updateTemplateApi({ id, archived });
      if (!ok) {
        notify(result.error || t.failed, "error");
        return;
      }
      if (archived && appliedTemplateId === id) setAppliedTemplateId("");
      await refreshTemplates();
      notify(archived ? t.templateArchivedToast : t.templateRestoredToast);
    } finally {
      setBusy("");
    }
  }

  async function deleteTemplate(id: string) {
    setBusy("template");
    try {
      const { ok, result } = await deleteTemplateApi(id);
      if (!ok) {
        notify(result.error || t.failed, "error");
        return;
      }
      if (appliedTemplateId === id) setAppliedTemplateId("");
      await refreshTemplates();
      // The server archives instead of deleting when messages reference it.
      notify(
        result.outcome === "archived"
          ? t.templateDeleteArchivedToast
          : t.templateDeletedToast,
      );
    } finally {
      setBusy("");
    }
  }

  /** Returns whether the product was persisted, so callers (the passport
   * modal) can leave edit mode only on success. */
  async function saveProduct(product = editing) {
    const saved = await saveProductApi(product);
    if (!saved.ok) {
      notify(
        saved.error === "plan_limit_reached"
          ? locale === "ru"
            ? "Лимит тарифа достигнут. Выберите более высокий тариф."
            : "Your plan limit has been reached. Choose a higher plan."
          : saved.error || t.failed,
        "error",
      );
      return false;
    }
    dispatch({ type: "productSaved", product });
    setProductSaved(true);
    setNewOpen(false);
    notify(t.toastSaved);
    return true;
  }

  // Niche monitoring is saved instantly (like the agent schedule), through
  // the products PATCH endpoint rather than the full product upsert.
  async function saveMonitoring(enabled: boolean, monitoringSources: string[]) {
    const previous = editingRef.current;
    const next: Product = {
      ...previous,
      monitoringEnabled: enabled,
      monitoringSources,
    };
    setBusy("monitoring");
    dispatch({ type: "editingChanged", product: next });
    try {
      const { ok, result } = await saveProductMonitoringApi({
        id: next.id,
        monitoringEnabled: enabled,
        monitoringSources,
      });
      if (!ok) {
        dispatch({ type: "editingChanged", product: previous });
        notify(
          result.error === "not_found" ? t.monitoringSaveFirst : result.error || t.failed,
          "error",
        );
        return;
      }
      // Keep the saved product list in sync with the applied settings.
      dispatch({ type: "productSaved", product: next });
      notify(t.monitoringSaved);
    } catch {
      dispatch({ type: "editingChanged", product: previous });
      notify(t.failed, "error");
    } finally {
      setBusy("");
    }
  }

  // «Подготовить всё»: registers the run. Every step is executed server-side
  // in bounded slices and leaves DRAFTS only — queued messages and draft
  // sequences the user reviews and starts by hand.
  async function startPipeline() {
    if (!productSaved) {
      notify(t.pipelineNothingToDo, "error");
      return;
    }
    setBusy("pipeline");
    try {
      const { ok, result } = await startPipelineApi(activeProduct.id);
      if (!ok) {
        if (result.run) setPipelineRun(result.run);
        notify(
          result.error === "pipeline_already_running"
            ? t.pipelineAlreadyRunning
            : result.error === "product_not_found"
              ? t.pipelineNothingToDo
              : result.error || t.failed,
          "error",
        );
        return;
      }
      if (result.run) setPipelineRun(result.run);
      notify(t.pipelineStarted);
    } finally {
      setBusy("");
    }
  }

  // "Продолжить" after the provider ran out of credits: the run picks up on
  // the very step it paused on, with its counters intact.
  async function resumePipeline() {
    setBusy("pipeline");
    try {
      const { ok, result } = await advancePipelineApi(activeProduct.id, "resume");
      if (!ok) {
        notify(result.error || t.failed, "error");
        return;
      }
      if (result.run) setPipelineRun(result.run);
    } finally {
      setBusy("");
    }
  }

  /**
   * Checks the product's own channels for its confirmed competitors.
   *
   * Deliberately manual. The analysis spends a search request per channel per
   * rival — more than the run that found the channels — so it happens when the
   * user asks and never quietly in the background.
   */
  async function runCompetitorGap() {
    setBusy("competitorGap");
    try {
      const { ok, result } = await runCompetitorGapApi(activeId);
      if (!ok) {
        notify(
          result.error === "no_competitors"
            ? t.gapNoCompetitors
            : result.error === "no_channels"
              ? t.gapNoChannels
              : t.gapFailed,
        );
        return;
      }
      const found = (result.gaps || []).length;
      notify(
        found
          ? t.gapFound
              .replace("{count}", String(found))
              .replace("{checked}", String(result.checked || 0))
          : t.gapNone.replace("{checked}", String(result.checked || 0)),
      );
      // The badges live on the channel rows, so the list has to be re-read.
      dispatch({ type: "refreshRequested" });
    } finally {
      setBusy("");
    }
  }

  async function analyzeProduct() {
    setBusy("analyze");
    try {
      const { ok, result } = await analyzeProductApi({ ...editing, locale });
      if (!ok) {
        notify(
          result.error === "ai_credits_exhausted"
            ? t.aiCreditsExhausted
            : result.error === "plan_limit_reached"
            ? locale === "ru"
              ? "Месячный лимит AI-запросов исчерпан."
              : "Your monthly AI request limit has been reached."
            : result.error === "analysis_format_invalid"
              ? locale === "ru"
                ? "Анализ не удалось завершить. Попробуйте ещё раз."
                : "The analysis could not be completed. Please try again."
              : result.error === "openrouter_request_failed"
                ? locale === "ru"
                  ? "Сервис анализа временно недоступен. Попробуйте ещё раз."
                  : "The analysis service is temporarily unavailable. Please try again."
            : result.error || t.failed,
          "error",
        );
        return;
      }
      if (result.analysis) {
        const next: Product = {
          ...editing,
          category: result.analysis.category || editing.category,
          audience: result.analysis.audience || editing.audience,
          negativeAudience:
            result.analysis.negativeAudience || editing.negativeAudience,
          analysis: result.analysis,
        };
        dispatch({ type: "editingChanged", product: next });
        await saveProduct(next);
        notify(
          result.mode === "setup" ? t.aiUnavailable : t.toastAnalyzed,
          result.mode === "setup" ? "error" : "success",
        );
      }
    } finally {
      setBusy("");
    }
  }

  // Shared by the new-product modal and the product edit panel: draft form
  // fields from a website. Returns null (after a toast) when prefill fails.
  async function requestPrefill(url: string): Promise<PrefillFields | null> {
    setBusy("prefill");
    try {
      const { ok, result } = await prefillProductApi(url, locale);
      if (!ok || !result.fields) {
        notify(
          result.error === "ai_credits_exhausted"
            ? t.aiCreditsExhausted
            : result.error === "plan_limit_reached"
            ? locale === "ru"
              ? "Месячный лимит AI-запросов исчерпан."
              : "Your monthly AI request limit has been reached."
            : result.error === "invalid_url"
              ? t.prefillInvalidUrl
              : result.error === "fetch_failed"
                ? t.prefillFetchFailed
                : t.prefillFailed,
          "error",
        );
        return null;
      }
      notify(t.toastPrefilled);
      return result.fields;
    } catch {
      notify(t.prefillFailed, "error");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function prefillEditingFromWebsite() {
    const url = editing.website.trim();
    if (!url) return;
    const fields = await requestPrefill(url);
    if (!fields) return;
    // Merge into the latest draft via the ref: only empty fields are filled,
    // values the user typed meanwhile are never overwritten.
    dispatch({
      type: "editingChanged",
      product: mergePrefillFields(editingRef.current, fields),
    });
  }

  async function discover(focusMotion = "") {
    if (discoveringRef.current) return;
    // The broad search is a background run.
    //
    // It used to be a synchronous request: three minutes of searching inside
    // one POST, with the results returned for this browser to save. On 13
    // August a run reached 216 seconds, the proxy cut it at 180, and
    // thirty-six channels that had already been searched for and paid for went
    // in the bin because the tab that was meant to save them got a 504. As a
    // run it advances a step per request, saves on the server, and the
    // two-minute timer finishes it even if the tab is closed.
    //
    // A motion tile stays synchronous: that is one model call for up to eight
    // results, well inside any timeout, and it is started from a place where
    // the user is watching for the answer.
    if (!focusMotion) return startDiscoveryRun();
    discoveringRef.current = true;
    setBusy("discover");
    try {
      const { ok, result } = await discoverApi(editing, sources, focusMotion, locale);
      if (!ok) {
        notify(
          result.error === "ai_credits_exhausted"
            ? t.aiCreditsExhausted
            : result.error === "plan_limit_reached"
            ? locale === "ru"
              ? "Месячный лимит найденных каналов исчерпан."
              : "Your monthly channel limit has been reached."
            : result.error === "discovery_format_invalid"
              ? locale === "ru"
                ? "Поиск не удалось завершить. Попробуйте ещё раз."
                : "The search could not be completed. Please try again."
              : result.error === "openrouter_request_failed"
                ? locale === "ru"
                  ? "Поиск временно недоступен. Попробуйте ещё раз."
                  : "Search is temporarily unavailable. Please try again."
            : result.error || t.failed,
          "error",
        );
        return;
      }
      const found: Lead[] = (result.results || []).map(
        (
          lead: Omit<
            Lead,
            "id" | "status" | "stage" | "revenueCents" | "outcomeNote"
          >,
        ) => ({
          ...lead,
          id: `${editing.id}:${lead.domain}:${lead.url}`.toLowerCase(),
          status: "review",
          stage: "discovered",
          revenueCents: 0,
          outcomeNote: "",
          opportunityType: lead.opportunityType || "partner",
          actionType: lead.actionType || "propose_partnership",
          nextAction: lead.nextAction || t.defaultNextAction,
          actionUrl: lead.actionUrl || lead.url,
          engagementMode: lead.engagementMode || "unknown",
          commercialModel: lead.commercialModel || "unknown",
          pricingSummary: lead.pricingSummary || "",
          placementRequirements: lead.placementRequirements || "",
          usageTerms: lead.usageTerms || "",
          registrationUrl: lead.registrationUrl || "",
          outreachEligible: Boolean(lead.outreachEligible),
        }),
      );
      dispatch({ type: "markDiscovered", productId: activeProduct.id });
      if (found.length) {
        await saveProspectsApi(activeProduct.id, found);
        // Run from a page that does not show the table: the results are on the
        // server now, so hand the user over to the page that renders them.
        if (view !== "channels") {
          window.location.assign(
            `${channelsPath}?product=${encodeURIComponent(activeProduct.id)}#found`,
          );
          return;
        }
        // Refetch the first page so the table matches what the server kept
        // (quota trimming, dedupe) instead of trusting the raw results.
        dispatch({ type: "discoveryApplied" });
      } else {
        notify(result.note || t.aiUnavailable, "error");
      }
    } finally {
      discoveringRef.current = false;
      setBusy("");
    }
  }

  /**
   * Starts the broad search as a pipeline run and returns immediately.
   *
   * Nothing is awaited beyond the row being created: the ticker above pushes
   * the run forward while this tab is open, the cron finishes it if the tab
   * goes away, and the finished-run effect refreshes the channel list.
   */
  async function startDiscoveryRun() {
    if (!productSaved) {
      notify(t.pipelineNothingToDo, "error");
      return;
    }
    setBusy("discover");
    try {
      const { ok, result } = await startPipelineApi(activeProduct.id, "discovery");
      if (!ok) {
        if (result.run) setPipelineRun(result.run);
        notify(
          result.error === "pipeline_already_running"
            ? t.pipelineAlreadyRunning
            : result.error === "product_not_found"
              ? t.pipelineNothingToDo
              : result.error || t.failed,
          "error",
        );
        return;
      }
      if (result.run) setPipelineRun(result.run);
      notify(t.discoveryStarted);
    } finally {
      setBusy("");
    }
  }

  // "Find channels for this motion" on a motion tile: run discovery focused on
  // the chosen mechanic. On the channels page the table is right there, so the
  // section is only scrolled into view; from the workspace `discover` itself
  // navigates once the results are saved.
  function discoverForMotion(motionId: string) {
    if (discoveringRef.current) return;
    if (view === "channels") {
      const url = new URL(window.location.href);
      url.hash = "channels";
      window.history.pushState({}, "", url);
      scrollToSection("channels");
    }
    void discover(motionId);
  }

  async function enrichContact(lead: Lead) {
    setBusy("enrich");
    try {
      const { ok, result } = await enrichContactApi(lead.id);
      if (!ok) {
        notify(
          result.error === "ai_credits_exhausted"
            ? t.aiCreditsExhausted
            : result.error === "plan_limit_reached"
            ? locale === "ru"
              ? "Месячный лимит AI-запросов исчерпан."
              : "Your monthly AI request limit has been reached."
            : result.error || t.failed,
          "error",
        );
        return;
      }
      const changes = {
          contact: result.contact || "",
          contactRole: result.role || "",
          email: result.email || "",
          telegram: result.telegram || "",
          linkedin: result.linkedin || "",
          contactStatus: result.contactStatus,
          contactSourceUrl: result.contactSourceUrl || "",
          contactEvidence: result.contactEvidence || "",
          // Enrichment may replace an empty next action with the
          // "register in <network>" line; it never overwrites a written one.
          ...(result.nextAction ? { nextAction: result.nextAction } : {}),
          contactConfidence: result.contactConfidence || 0,
          contactCheckedAt: result.contactCheckedAt,
      };
      dispatch({ type: "leadUpdated", id: lead.id, changes });
      // The check can move a lead off the `direct` route (no contact anywhere,
      // the way in is an affiliate network). Its grouping and the chip counts
      // are server-derived, so they need one refetch to catch up.
      if (contactRouteForLead({ ...lead, ...changes }) !== "direct") {
        dispatch({ type: "refreshRequested" });
      }
      // A billed-but-unreadable model answer is not "nothing found": saying so
      // would close the lead on evidence that was never gathered.
      notify(
        result.contactStatus === "check_failed"
          ? locale === "ru"
            ? "Проверка не завершилась: ответ модели не удалось прочитать. Попробуйте ещё раз."
            : "The check did not finish: the model answer could not be read. Try again."
          : result.contactStatus === "not_found"
            ? locale === "ru"
              ? "Публичный контакт не найден."
              : "No public contact found."
            : locale === "ru"
              ? "Контактные данные обновлены."
              : "Contact details updated.",
        result.contactStatus === "check_failed" ? "error" : undefined,
      );
    } finally {
      setBusy("");
    }
  }

  async function updateLeadStatus(
    id: string,
    status: "approved" | "rejected",
  ) {
    const previousLead = leads.find((lead) => lead.id === id);
    if (!previousLead) return;
    dispatch({ type: "leadUpdated", id, changes: { status } });
    try {
      const ok = await updateProspectApi({ id, status });
      if (!ok) {
        dispatch({ type: "leadStatusRollback", lead: previousLead });
        notify(t.failed, "error");
        return;
      }
    } catch {
      dispatch({ type: "leadStatusRollback", lead: previousLead });
      notify(t.failed, "error");
      return;
    }
    // Keep the current page and funnel counters in sync with the server.
    refreshLeads();
    if (status === "approved") {
      const approvedLead = leads.find((lead) => lead.id === id);
      if (approvedLead && engagementModeForLead(approvedLead) === "outreach") {
        // Approving a channel where a human decides IS the decision to write
        // to it — the mode already says so, and asking again with a second
        // button would be making the user answer a question they answered by
        // pressing approve. The draft goes straight into Outreach.
        const draft = await generateOutreach({ ...approvedLead, status: "approved" });
        if (draft) {
          await queueDraft(approvedLead, draft);
          notify(t.queuedForOutreach);
        }
      }
    }
  }

  // Placement tracking for self-serve leads (free listings and paid
  // placements): optimistic update with rollback, like updateLeadStatus.
  async function updateLeadPlacement(
    id: string,
    changes: { placementStatus?: PlacementStatus; placementUrl?: string },
  ) {
    const previousLead = leads.find((lead) => lead.id === id);
    if (!previousLead) return;
    const optimistic: Partial<Lead> = { ...changes };
    if (
      changes.placementStatus === "submitted" &&
      !previousLead.placementSubmittedAt
    ) {
      // The server stamps the authoritative timestamp; mirror it locally so
      // the "submitted N days ago" hint appears without waiting for a refetch.
      optimistic.placementSubmittedAt = new Date().toISOString();
    }
    dispatch({ type: "leadUpdated", id, changes: optimistic });
    try {
      const ok = await updateProspectApi({ id, ...changes });
      if (!ok) {
        dispatch({ type: "leadStatusRollback", lead: previousLead });
        notify(t.failed, "error");
        return;
      }
    } catch {
      dispatch({ type: "leadStatusRollback", lead: previousLead });
      notify(t.failed, "error");
      return;
    }
    // Resync the server-side timestamps and the placement summary counters.
    refreshLeads();
    notify(t.placementSaved);
  }

  // Assign a lead to a workspace member ('' clears the assignment):
  // optimistic update with rollback, like updateLeadStatus.
  async function assignLead(id: string, assignedUserId: string) {
    const previousLead = leads.find((lead) => lead.id === id);
    if (!previousLead) return;
    dispatch({ type: "leadUpdated", id, changes: { assignedUserId } });
    try {
      const ok = await updateProspectApi({ id, assignedUserId });
      if (!ok) {
        dispatch({ type: "leadStatusRollback", lead: previousLead });
        notify(t.failed, "error");
        return;
      }
    } catch {
      dispatch({ type: "leadStatusRollback", lead: previousLead });
      notify(t.failed, "error");
      return;
    }
    // Under the "mine" filter the lead may leave the current page.
    if (assignedFilter === "mine") refreshLeads();
    notify(t.assigneeSaved);
  }

  async function addComment(body: string) {
    if (!selectedLead) return false;
    setBusy("comment");
    try {
      const { ok, result } = await addLeadCommentApi(selectedLead.id, body);
      if (!ok || !result.comment) {
        notify(result.error || t.failed, "error");
        return false;
      }
      setComments((current) => [...current, result.comment!]);
      dispatch({
        type: "leadUpdated",
        id: selectedLead.id,
        changes: { commentCount: (selectedLead.commentCount || 0) + 1 },
      });
      notify(t.commentAdded);
      return true;
    } finally {
      setBusy("");
    }
  }

  async function deleteComment(id: string) {
    if (!selectedLead) return;
    setBusy("comment");
    try {
      const ok = await deleteLeadCommentApi(id);
      if (!ok) {
        notify(t.failed, "error");
        return;
      }
      setComments((current) => current.filter((item) => item.id !== id));
      dispatch({
        type: "leadUpdated",
        id: selectedLead.id,
        changes: {
          commentCount: Math.max(0, (selectedLead.commentCount || 0) - 1),
        },
      });
      notify(t.commentDeleted);
    } finally {
      setBusy("");
    }
  }

  async function refreshTeam() {
    const team = await fetchTeam();
    setTeamData(team);
  }

  // Returns the shareable invite link so TeamSection can show a copy field.
  async function inviteMember(email: string): Promise<string | null> {
    setBusy("team");
    try {
      const { ok, result } = await inviteMemberApi(email);
      if (!ok || !result.inviteUrl) {
        notify(
          result.error === "invalid_email"
            ? t.teamInvalidEmail
            : result.error === "already_member"
              ? t.teamAlreadyMember
              : result.error === "plan_limit_reached"
                ? t.teamLimitReached
                : result.error === "forbidden"
                  ? t.teamOwnerOnly
                  : result.error || t.failed,
          "error",
        );
        return null;
      }
      await refreshTeam();
      notify(t.teamInviteCreated);
      return result.inviteUrl;
    } finally {
      setBusy("");
    }
  }

  async function removeMember(userId: string) {
    setBusy("team");
    try {
      const ok = await removeMemberApi(userId);
      if (!ok) {
        notify(t.failed, "error");
        return;
      }
      await refreshTeam();
      refreshLeads();
      notify(t.teamRemoved);
    } finally {
      setBusy("");
    }
  }

  async function revokeInvite(inviteId: string) {
    setBusy("team");
    try {
      const ok = await revokeInviteApi(inviteId);
      if (!ok) {
        notify(t.failed, "error");
        return;
      }
      await refreshTeam();
      notify(t.teamRevoked);
    } finally {
      setBusy("");
    }
  }

  // Generate the UTM link once, persist it on the lead, and copy it.
  async function copyUtmLink(lead: Lead) {
    const mode = engagementModeForLead(lead);
    const link =
      lead.utmLink ||
      buildUtmLink(activeProduct.website, {
        source: lead.domain,
        medium:
          mode === "paid_placement"
            ? "paid"
            : mode === "outreach"
              ? "outreach"
              : "listing",
        campaign: activeProduct.id,
      });
    if (!link) {
      notify(t.utmNeedsWebsite, "error");
      return;
    }
    if (!lead.utmLink) {
      dispatch({ type: "leadUpdated", id: lead.id, changes: { utmLink: link } });
      try {
        const ok = await updateProspectApi({ id: lead.id, utmLink: link });
        if (!ok) {
          dispatch({ type: "leadStatusRollback", lead });
          notify(t.failed, "error");
          return;
        }
      } catch {
        dispatch({ type: "leadStatusRollback", lead });
        notify(t.failed, "error");
        return;
      }
    }
    await navigator.clipboard.writeText(link);
    notify(t.utmCopied);
  }

  /**
   * Prepares the message and, when asked, sends it in the same click.
   *
   * Sending used to be a second step on a different page, and the button that
   * ended the compose form said "Add to queue" over a toast that said the same.
   * Nobody read that as unfinished: /api/send was not called once in thirty
   * days while three messages sat queued. The queue is right for a series and
   * for anything deliberately held back; for one email it was friction with
   * nothing on the other side of it.
   */
  /**
   * Puts a draft into Outreach for a named lead.
   *
   * Split out of queueMessage, which reads the composer's state and therefore
   * only works for whatever is selected right now. Approval happens from a row
   * in the list, which may not be the selected one, and the draft it produced
   * has not reached state yet either.
   */
  async function queueDraft(lead: Lead, draft: { subject: string; body: string }) {
    const message: Message = {
      id: crypto.randomUUID(),
      productId: activeProduct.id,
      leadId: lead.id,
      company: lead.company,
      channel: "email",
      subject: draft.subject,
      body: draft.body,
      templateId: "",
      status: "queued",
      createdAt: new Date().toISOString(),
      email: lead.email,
      telegram: lead.telegram,
    };
    const { ok, result } = await createMessageApi(message);
    if (!ok || !result.persisted) {
      const failure = sendFailure(result.error);
      notify(failure.text, "error", failure.action);
      return;
    }
    setMessages((current) => [message, ...current]);
  }

  async function queueMessage(sendNow = false) {
    if (!selectedLead) return;
    const message: Message = {
      id: crypto.randomUUID(),
      productId: activeProduct.id,
      leadId: selectedLead.id,
      company: selectedLead.company,
      channel,
      subject: channel === "email" ? subject : "",
      body,
      templateId: appliedTemplateId,
      status: "queued",
      createdAt: new Date().toISOString(),
      email: selectedLead.email,
      telegram: selectedLead.telegram,
    };
    try {
      const { ok, result } = await createMessageApi(message);
      if (!ok || !result.persisted) {
        const failure = sendFailure(result.error);
        notify(failure.text, "error", failure.action);
        return;
      }
      setMessages((current) => [message, ...current]);
      dispatch({
        type: "leadPatched",
        id: selectedLead.id,
        changes: { stage: result.stage || selectedLead.stage },
      });
      refreshLeads();
    } catch {
      notify(t.failed, "error");
      return;
    }
    // Queueing the prepared message is what the follow-up task asked for, so
    // the task closes here — the message itself still waits for a send click.
    const startedTask = tasks.find((item) => item.id === taskFocusRef.current);
    if (startedTask) await updateTask(startedTask, "done");
    if (sendNow) {
      await sendEmail(message);
      return;
    }
    // The toast says what did not happen as well as what did, and carries the
    // way to finish: a confirmation that hides an unfinished step is a lie
    // told politely.
    notify(t.toastQueued, "success", {
      href: "/dashboard/queue",
      label: t.toastQueuedAction,
    });
  }

  async function copyMessage(message: Message) {
    await navigator.clipboard.writeText(
      [message.subject, message.body].filter(Boolean).join("\n\n"),
    );
    notify(t.toastCopied);
  }

  async function removeMessage(id: string) {
    try {
      const ok = await deleteMessageApi(id);
      if (!ok) {
        notify(t.failed, "error");
        return;
      }
      setMessages((current) => current.filter((message) => message.id !== id));
    } catch {
      notify(t.failed, "error");
    }
  }

  // With server-side pagination a referenced lead may live outside the current
  // page, so look it up in the funnel list too and patch both copies.
  function findLead(id: string) {
    return (
      leads.find((item) => item.id === id) ||
      outcomeLeads.find((item) => item.id === id) ||
      // A lead opened from a task can live on any page of any product.
      (taskFocus?.lead.id === id ? taskFocus.lead : undefined)
    );
  }

  // Outreach always leaves through the workspace's own connected Gmail.
  async function sendEmail(message: Message) {
    if (sendingRef.current) return;
    const lead = findLead(message.leadId);
    const to = message.email || lead?.email;
    if (!to) {
      notify(t.noEmail, "error");
      return;
    }
    sendingRef.current = true;
    try {
      const { ok, result } = await sendEmailApi({
        messageId: message.id,
        provider: "gmail",
        to,
        subject: message.subject,
        body: message.body,
      });
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                status: ok
                  ? "sent"
                  : result.error === "send_in_progress"
                    ? "sending"
                    : "failed",
                error: result.diagnostic || result.error,
                errorStatusCode: result.statusCode,
                sendUncertain:
                  result.error === "gmail_delivery_unconfirmed" ? 1 : 0,
              }
            : item,
        ),
      );
      if (ok && lead) {
        dispatch({
          type: "leadPatched",
          id: lead.id,
          changes: { stage: "contacted" },
        });
        refreshLeads();
      }
      if (ok) notify(t.sent);
      else {
        const failure = sendFailure(result.error);
        notify(failure.text, "error", failure.action);
      }
    } catch {
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, status: "failed" } : item,
        ),
      );
      notify(t.failed, "error");
    } finally {
      sendingRef.current = false;
    }
  }

  // LinkedIn only. The Telegram branch opened a t.me link with the text on the
  // clipboard, which is the user sending the message themselves — and the
  // interface presented it as a channel Chanlyst had connected.
  async function openManual(message: Message, type: "linkedin") {
    void type;
    await copyMessage(message);
    const lead = findLead(message.leadId);
    window.open(
      lead?.url || `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(message.company)}`,
      "_blank",
      "noopener,noreferrer",
    );
    if (lead) {
      await updateOutcome(lead.id, "contacted", undefined, undefined, false);
    }
  }

  async function updateOutcome(
    id: string,
    stage: ProspectStage,
    revenueCents?: number,
    outcomeNote?: string,
    showToast = true,
  ) {
    const lead = findLead(id);
    if (!lead) return;
    const next = {
      ...lead,
      stage,
      revenueCents: revenueCents ?? lead.revenueCents ?? 0,
      outcomeNote: outcomeNote ?? lead.outcomeNote ?? "",
    };
    dispatch({ type: "leadPatched", id, changes: next });
    const ok = await updateProspectApi({
      id,
      stage,
      revenueCents: next.revenueCents,
      outcomeNote: next.outcomeNote,
    });
    if (!ok) {
      dispatch({ type: "leadPatched", id, changes: lead });
      notify(t.failed, "error");
      return;
    }
    refreshLeads();
    if (showToast) notify(t.toastOutcome);
  }

  // The integration key fields live inside IntegrationsSection; the section
  // passes the entered values here and clears them when the call succeeds.
  // The AI provider runs on a system key from the environment, so Gmail is the
  // only credential a customer can enter.
  async function configureGmail(clientId: string, clientSecret: string) {
    setBusy("integration");
    try {
      const { ok, result } = await saveIntegrationApi({
        provider: "gmail_config",
        clientId,
        clientSecret,
      });
      if (!ok) {
        notify(result.error || t.failed, "error");
        return false;
      }
      const status = await fetchIntegrations();
      setIntegrationData(status);
      notify(t.gmailConfigured);
      return true;
    } finally {
      setBusy("");
    }
  }

  async function signOut() {
    await deleteSessionApi();
    window.location.assign("/login");
  }

  async function startCheckout(
    plan: PlanId,
    interval: "monthly" | "annual",
  ) {
    setBusy("billing");
    try {
      const { ok, result } = await startCheckoutApi(plan, interval);
      if (!ok || !result.url) {
        notify(result.error || t.billingNotReady, "error");
        return;
      }
      window.location.assign(result.url);
    } catch {
      notify(t.billingNotReady, "error");
    } finally {
      setBusy("");
    }
  }

  function formatBillingDate(value?: string | null) {
    if (!value) return "";
    return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(value));
  }

  const activeMessages = messages.filter(
    (message) => message.productId === activeProduct.id,
  );
  const hasReached = (lead: Lead, stage: ProspectStage) => {
    const order: ProspectStage[] = [
      "discovered",
      "queued",
      "contacted",
      "replied",
      "meeting",
      "won",
    ];
    if (lead.stage === "lost") return false;
    return order.indexOf(lead.stage) >= order.indexOf(stage);
  };
  // Funnel metrics come from the server-provided outcome list (leads that
  // entered the funnel) so they stay correct regardless of the visible page.
  const funnel = [
    { label: t.discovered, value: leadCounts.all },
    {
      label: t.approvedMetric,
      value: outcomeLeads.filter((lead) => lead.status === "approved").length,
    },
    {
      label: t.contacted,
      value: outcomeLeads.filter((lead) => hasReached(lead, "contacted")).length,
    },
    {
      label: t.replied,
      value: outcomeLeads.filter((lead) => hasReached(lead, "replied")).length,
    },
    {
      label: t.meetings,
      value: outcomeLeads.filter((lead) => hasReached(lead, "meeting")).length,
    },
    {
      label: t.customers,
      value: outcomeLeads.filter((lead) => lead.stage === "won").length,
    },
  ];
  const revenue = outcomeLeads.reduce(
    (sum, lead) => sum + (lead.stage === "won" ? lead.revenueCents || 0 : 0),
    0,
  );
  // Leads that were touched but are not closed yet — the "в работе" tile.
  // The funnel list already covers every page of the active product.
  const inWorkLeads = outcomeLeads.filter(
    (lead) => lead.stage === "contacted" || lead.stage === "replied",
  ).length;
  const productParam = activeProduct.id
    ? `?product=${encodeURIComponent(activeProduct.id)}`
    : "";
  const channelsHref = `${channelsPath}${productParam}`;
  const productsHref = `${productsPath}${productParam}`;
  // Checklist step 4: a message this product actually sent. The workspace
  // loads the message list on mount, and a lead that reached "contacted"
  // (a manual Telegram/LinkedIn hand-off) counts too.
  const firstMessageSent =
    activeMessages.some((message) => message.status === "sent") ||
    funnel[2].value > 0;
  const stageLabels: Record<ProspectStage, string> =
    locale === "ru"
      ? {
          discovered: "Найден",
          queued: "В очереди",
          contacted: "Отправлено",
          replied: "Получен ответ",
          meeting: "Назначена встреча",
          won: "Платный клиент",
          lost: "Не сработало",
        }
      : {
          discovered: "Discovered",
          queued: "Queued",
          contacted: "Contacted",
          replied: "Replied",
          meeting: "Meeting booked",
          won: "Paying customer",
          lost: "Did not work",
        };

  return (
    <main className="signalist">
      <aside className="side">
        <div className="logo"><BrandMark size={42} tile="transparent" />Chanlyst</div>
        <nav>
          <Link className={view === "products" ? "active" : ""} href={productsHref}>{t.products}</Link>
          <Link className={view === "channels" ? "active" : ""} href={channelsHref}>{t.channels}</Link>
          {/* Contacts is no longer its own section: what it listed was
              companies you write to, which is the same work as an outreach
              channel, so they are shown under Outreach. The route stays
              reachable for anyone holding an old link. */}
          <Link className={view === "queue" ? "active" : ""} href="/dashboard/queue">{t.queue}<b>{activeMessages.length}</b></Link>
          <Link className={view === "results" ? "active" : ""} href="/dashboard/results">{t.results}<b>{funnel[5].value}</b></Link>
          <Link className={view === "agent" ? "active" : ""} href="/dashboard/agent">{locale === "ru" ? "Агент" : "Agent"}</Link>
          {/* Integrations is hidden from the sidebar for now. The page itself
              stays reachable at /dashboard/integrations, because it holds the
              only Gmail connect button — without that link there is no way to
              turn sending on at all. */}
          {/* No payment provider, no subscription section. A self-hosted
              install pays OpenRouter and Serper directly and has nobody to
              subscribe to; showing it a plan page would be showing it a door
              that opens onto our billing account. The route stays reachable,
              so an install that configures a provider later needs no migration
              beyond the env var. */}
          {billingData.configured !== false && (
            <Link className={view === "billing" ? "active" : ""} href="/dashboard/billing">{t.billing}</Link>
          )}
        </nav>
        <div className="safe-card">
          <strong><i />{t.safe}</strong>
          <p>{t.safeText}</p>
        </div>
        <div className="side-status">
          <span className={connected.gmail ? "on" : ""}>Gmail</span>
        </div>
        <div className="side-account">
          <span>{(sessionUser.name || sessionUser.email || "C").slice(0, 2).toUpperCase()}</span>
          <div><strong>{sessionUser.name || "Chanlyst user"}</strong><small>{sessionUser.email || t.workspace}</small></div>
          <button onClick={signOut} title={t.signOut}>↪</button>
        </div>
      </aside>

      <section className="content">
        <header className="top">
          <div>
            <small>Chanlyst</small>
            <h1>
              {view === "agent"
                ? locale === "ru" ? "Агент" : "Agent"
                : view === "integrations"
                  ? t.integrations
                  : view === "billing"
                    ? t.billing
                    : view === "results"
                      ? t.results
                      : view === "channels"
                        ? t.channels
                        : view === "contacts"
                          ? t.contacts
                        : view === "queue"
                          ? t.queue
                          : t.products}
            </h1>
            {(view === "channels" || view === "contacts" || view === "queue" || view === "products") && (
              <p className="top-subtitle">
                {view === "channels"
                  ? t.channelsPageHint
                  : view === "contacts"
                    ? t.contactsPageHint
                  : view === "queue"
                    ? t.queuePageHint
                    : t.productsPageHint}
              </p>
            )}
            {view === "channels" && (
          <OverviewMetrics
            t={t}
            locale={locale}
            loading={leadsLoading}
            found={leadCounts.all}
            inWork={inWorkLeads}
            replies={funnel[3].value}
            customers={funnel[5].value}
            revenueCents={revenue}
            resultsHref={`/dashboard/results${productParam}`}
          />
        )}

        {view === "channels" && (
              <div className="top-stats" id="channel-stats">
                {(
                  [
                    [t.channelsStatFound, leadCounts.all],
                    [t.channelsStatToSubmit, placementCounts.to_submit],
                    [t.channelsStatSubmitted, placementCounts.submitted],
                    [t.channelsStatReplies, funnel[3].value],
                  ] as [string, number][]
                ).map(([label, value]) => (
                  <span key={label}>
                    <small>{label}</small>
                    <strong>{leadsLoading ? "—" : value}</strong>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="top-actions">
            <div className="language" role="group" aria-label={locale === "ru" ? "Язык" : "Language"}><button type="button" aria-pressed={locale === "ru"} className={locale === "ru" ? "active" : ""} onClick={() => chooseLocale("ru")}>RU</button><button type="button" aria-pressed={locale === "en"} className={locale === "en" ? "active" : ""} onClick={() => chooseLocale("en")}>EN</button></div>
            {staleContent > 0 && (
              <small className="stale-locale" title={t.staleLocaleHint}>
                {t.staleLocale.replace("{count}", String(staleContent))}
              </small>
            )}
            {view === "products" && <button className="outline" onClick={() => setNewOpen(true)}>＋ {t.addProduct}</button>}
          </div>
        </header>

        {view === "products" && <>
        <ProductPanel
          variant="card"
          t={t}
          locale={locale}
          products={products}
          activeId={activeId}
          editing={editing}
          setEditing={(product) => dispatch({ type: "editingChanged", product })}
          busy={busy}
          chooseProduct={chooseProduct}
          setNewOpen={setNewOpen}
          saveProduct={saveProduct}
          analyzeProduct={analyzeProduct}
          runCompetitorGap={runCompetitorGap}
          prefillFromWebsite={prefillEditingFromWebsite}
          discoverForMotion={discoverForMotion}
          saveMonitoring={saveMonitoring}
          pipelineRun={activePipelineRun}
          startPipeline={startPipeline}
          resumePipeline={resumePipeline}
        />

        {/* Last on the page, not first: it is the path from a saved product to
            a first reply, so it reads after the product it is about. It used
            to sit on a section of its own called «Сегодня», which the Products
            page and the Channels page had between them made redundant. */}
        <LaunchChecklist
          t={t}
          workspaceId={workspaceId}
          ready={!leadsLoading}
          productAdded={productSaved}
          analysisDone={
            productSaved &&
            Boolean(
              activeProduct.analysis.summary?.trim() ||
                activeProduct.analysis.acquisitionMotions?.length,
            )
          }
          channelsFound={leadCounts.all > 0}
          messageSent={firstMessageSent}
          replyReceived={funnel[3].value > 0}
          addProduct={() => setNewOpen(true)}
          analysisHref={productsHref}
          channelsHref={channelsHref}
        />
        </>}

        {view === "channels" && <>
        <SourcesSection
          t={t}
          locale={locale}
          editing={editing}
          sources={sources}
          setSources={setSources}
          busy={busy}
          discover={discover}
          hasDiscovered={hasDiscovered}
          startPipeline={startPipeline}
          run={activePipelineRun}
        />

        <LeadsTable
          t={t}
          locale={locale}
          exportUrl={`/api/prospects/export?productId=${encodeURIComponent(activeProduct.id)}`}
          visibleLeads={leads}
          totalLeads={leadTotal}
          leadCounts={leadCounts}
          placementCounts={placementCounts}
          newCount={newCount}
          loading={leadsLoading || busy === "discover"}
          hasDiscovered={hasDiscovered}
          selectedLead={selectedLead}
          selectedLeadMode={selectedLeadMode}
          leadModeFilter={leadModeFilter}
          leadPageCount={leadPageCount}
          effectiveLeadPage={effectiveLeadPage}
          setLeadPage={(page) => dispatch({ type: "pageChanged", page })}
          busy={busy}
          chooseLead={chooseLead}
          chooseLeadModeFilter={chooseLeadModeFilter}
          discover={discover}
          startPipeline={startPipeline}
          updateLeadStatus={updateLeadStatus}
          updateLeadPlacement={updateLeadPlacement}
          copyUtmLink={copyUtmLink}
          enrichContact={enrichContact}
          members={teamData.members || []}
          currentUserId={sessionUser.id || ""}
          isOwner={teamData.role === "owner"}
          assignedFilter={assignedFilter}
          chooseAssignedFilter={(filter) =>
            dispatch({ type: "assignedFilterChanged", filter })
          }
          assignLead={assignLead}
          comments={comments}
          commentsLoading={commentsLeadId !== (selectedLead?.id || "")}
          addComment={addComment}
          deleteComment={deleteComment}
        />

        </>}

        {view === "contacts" && <>
        <ContactsSection
          locale={locale}
          contacts={leads}
          total={leadTotal}
          loading={Boolean(activeId) && leadsLoading}
          selectedId={selectedLead?.id || ""}
          page={effectiveLeadPage}
          pageCount={leadPageCount}
          choose={chooseLead}
          setPage={(page) => dispatch({ type: "pageChanged", page })}
          enrich={enrichContact}
          approve={(id) => void updateLeadStatus(id, "approved")}
          busy={busy}
        />

        <Composer
          t={t}
          locale={locale}
          selectedLead={selectedLead}
          selectedLeadMode={selectedLeadMode}
          busy={busy}
          channel={channel}
          chooseChannel={chooseChannel}
          subject={subject}
          setSubject={setSubject}
          body={body}
          setBody={setBody}
          queueMessage={queueMessage}
          gmailConnected={Boolean(connected.gmail)}
          templates={templates}
          appliedTemplateId={appliedTemplateId}
          applyTemplate={applyTemplate}
          saveComposerAsTemplate={saveComposerAsTemplate}
          saveTemplateEdits={saveTemplateEdits}
          setTemplateArchived={setTemplateArchived}
          deleteTemplate={deleteTemplate}
          buildSequence={buildSequence}
          sequenceSteps={sequenceSteps}
          setSequenceSteps={setSequenceSteps}
          createOutreachSequence={createOutreachSequence}
          savedSequence={savedSequence}
          startSavedSequence={startSavedSequence}
          dismissSavedSequence={() => setSavedSequence(null)}
        />
        </>}

        {/* The companies a run finds, above the queue they feed. Both halves of
            this page are the same job — write to a person — so they sit on one
            screen rather than in two sections that differ only in where the
            name came from. */}
        {view === "queue" && (
          <ContactsSection
            locale={locale}
            contacts={leads}
            total={leadTotal}
            loading={Boolean(activeId) && leadsLoading}
            selectedId={selectedLead?.id || ""}
            page={effectiveLeadPage}
            pageCount={leadPageCount}
            choose={chooseLead}
            setPage={(page) => dispatch({ type: "pageChanged", page })}
            enrich={enrichContact}
            approve={(id) => void updateLeadStatus(id, "approved")}
            busy={busy}
          />
        )}

        {/* Writing lives here, not on Channels. Channels answers "where do we
            go"; this page answers "what do we say", and approving a channel
            already drops its draft into the queue below. Keeping the composer
            next to the list it writes to means one screen holds the whole job
            rather than two pages each holding half of it. */}
        {view === "queue" && (
        <Composer
          t={t}
          locale={locale}
          selectedLead={selectedLead}
          selectedLeadMode={selectedLeadMode}
          busy={busy}
          channel={channel}
          chooseChannel={chooseChannel}
          subject={subject}
          setSubject={setSubject}
          body={body}
          setBody={setBody}
          queueMessage={queueMessage}
          gmailConnected={Boolean(connected.gmail)}
          templates={templates}
          appliedTemplateId={appliedTemplateId}
          applyTemplate={applyTemplate}
          saveComposerAsTemplate={saveComposerAsTemplate}
          saveTemplateEdits={saveTemplateEdits}
          setTemplateArchived={setTemplateArchived}
          deleteTemplate={deleteTemplate}
          buildSequence={buildSequence}
          sequenceSteps={sequenceSteps}
          setSequenceSteps={setSequenceSteps}
          createOutreachSequence={createOutreachSequence}
          savedSequence={savedSequence}
          startSavedSequence={startSavedSequence}
          dismissSavedSequence={() => setSavedSequence(null)}
        />
        )}

        {view === "queue" && (
        <QueueSection
          t={t}
          locale={locale}
          activeProduct={activeProduct}
          activeMessages={activeMessages}
          connected={connected}
          sendEmail={sendEmail}
          openManual={openManual}
          copyMessage={copyMessage}
          removeMessage={removeMessage}
          outreachSequences={outreachSequences}
          updateOutreachSequence={updateOutreachSequence}
          checkReplies={checkReplies}
          busy={busy}
        />
        )}

        {view === "results" && (
          <>
          {/* What to do next, above what has happened so far. It used to open
              a section of its own called «Сегодня», next to a portfolio the
              Products page already had and a metrics strip the Channels page
              already had — so the section went and the list came here, beside
              the outcomes it is reacting to. */}
          <TodaySection
            t={t}
            tasks={tasks}
            busy={busy}
            startTask={startTask}
            snoozeTask={(task) => updateTask(task, "snooze")}
            dismissTask={(task) => updateTask(task, "dismiss")}
            refreshTasks={refreshTasks}
          />

          <ResultsSection
            t={t}
            locale={locale}
            productId={activeId}
            analyticsRefreshKey={leadRefresh}
            funnel={funnel}
            revenue={revenue}
            outcomeLeads={outcomeLeads}
            stageLabels={stageLabels}
            updateOutcome={updateOutcome}
            patchOutcomeLead={(id, changes) =>
              dispatch({ type: "outcomeLeadEdited", id, changes })
            }
          />
          </>
        )}

        {view === "agent" && (
          <AgentSection
            locale={locale}
            agentData={agentData}
            busy={busy}
            saveAgentSchedule={saveAgentSchedule}
            runAgentNow={runAgentNow}
            digestData={digestData}
            saveDigestSettings={saveDigestSettings}
            sendDigestNow={sendDigestNow}
          />
        )}

        {view === "integrations" && (
          <IntegrationsSection
            t={t}
            configured={configured}
            connected={connected}
            busy={busy}
            configureGmail={configureGmail}
          />
        )}

        {view === "billing" && (
          <>
            <BillingSection
              t={t}
              locale={locale}
              billingData={billingData}
              currentPlan={currentPlan}
              busy={busy}
              startCheckout={startCheckout}
              formatBillingDate={formatBillingDate}
            />
            <TeamSection
              t={t}
              team={teamData}
              sessionUserId={sessionUser.id || ""}
              busy={busy}
              inviteMember={inviteMember}
              removeMember={removeMember}
              revokeInvite={revokeInvite}
              notify={notify}
            />
          </>
        )}
      </section>

      {newOpen && <div className="modal-bg"><div className="modal"><button className="modal-close" onClick={() => setNewOpen(false)}>×</button><small>NEW PRODUCT</small><h2>{t.addProduct}</h2><p>{t.productHint}</p><NewProductForm locale={locale} busy={busy} onSave={saveProduct} onPrefill={requestPrefill} /></div></div>}
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((item) => (
            <div
              key={item.id}
              className={item.type === "error" ? "toast error" : "toast"}
              role={item.type === "error" ? "alert" : "status"}
            >
              {item.text}
              {item.action && (
                <a href={item.action.href}>{item.action.label}</a>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
