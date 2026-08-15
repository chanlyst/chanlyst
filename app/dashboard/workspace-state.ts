import {
  leadsPerPage,
  blankProduct,
  type Lead,
  type LeadModeCounts,
  type LeadModeFilter,
  type PlacementCounts,
  type Product,
} from "./types";

export const emptyLeadCounts: LeadModeCounts = {
  all: 0,
  free_listing: 0,
  paid_placement: 0,
  outreach: 0,
  network_route: 0,
  competitors: 0,
  doubtful: 0,
};

export const emptyPlacementCounts: PlacementCounts = {
  to_submit: 0,
  submitted: 0,
  published: 0,
  rejected: 0,
};

export const leadModeFilters: LeadModeFilter[] = [
  "all",
  "free_listing",
  "paid_placement",
  "outreach",
  "network_route",
  "doubtful",
];

// The tightly-coupled workspace group: the product being worked on plus the
// server-paginated lead list that depends on it. Everything that previously
// had to be kept in sync by hand across several setState calls lives here so
// each transition is applied atomically.
export type WorkspaceState = {
  products: Product[];
  activeId: string;
  editing: Product;
  /** Current page of leads — filtering and pagination happen server-side. */
  leads: Lead[];
  leadTotal: number;
  leadCounts: LeadModeCounts;
  /** Placement pipeline counters for the currently applied mode filter. */
  placementCounts: PlacementCounts;
  /** Funnel list of leads that entered the outcome pipeline (all pages). */
  outcomeLeads: Lead[];
  /** Leads created since the last visit to the active product (monitoring). */
  newCount: number;
  /** Query key of the last applied response; drives the loading skeleton. */
  loadedLeadKey: string;
  /** Bumped to force a refetch of the current page. */
  leadRefresh: number;
  /** Products for which discovery has run at least once this session. */
  discoveredProducts: Record<string, boolean>;
  leadPage: number;
  leadModeFilter: LeadModeFilter;
  /** "mine" narrows the server query to leads assigned to the current user. */
  assignedFilter: "all" | "mine";
  selectedLeadId: string;
};

export type WorkspaceAction =
  /** Initial load: apply the fetched product list and the product chosen from the URL. */
  | { type: "productsLoaded"; products: Product[]; initial: Product }
  /** Initial load: restore the lead filter from the URL without resetting anything. */
  | { type: "filterRestored"; filter: LeadModeFilter }
  /** User switched products: clear the lead workspace and start from page 1. */
  | { type: "selectProduct"; product: Product }
  /** Product form edits (does not touch the saved list). */
  | { type: "editingChanged"; product: Product }
  /** A product was persisted: upsert the list and make it active. */
  | { type: "productSaved"; product: Product }
  /** A prospects response arrived: apply the page, clamp the page number, repair the selection. */
  | {
      type: "leadsPageLoaded";
      leads: Lead[];
      total: number;
      counts: LeadModeCounts;
      placementCounts: PlacementCounts;
      outcomeLeads: Lead[];
      newCount: number;
      requestKey: string;
    }
  /** A prospects request failed: mark the query as settled so the skeleton hides. */
  | { type: "leadsPageFailed"; requestKey: string }
  | { type: "leadSelected"; id: string }
  /** User switched the mode filter: back to page 1, selection is repaired by the refetch. */
  | { type: "filterChanged"; filter: LeadModeFilter }
  /** User toggled the "mine" chip: back to page 1, selection is repaired. */
  | { type: "assignedFilterChanged"; filter: "all" | "mine" }
  | { type: "pageChanged"; page: number }
  /** Force a refetch of the current page (counts/funnel resync). */
  | { type: "refreshRequested" }
  /** Discovery ran for a product (even when it returned nothing). */
  | { type: "markDiscovered"; productId: string }
  /** Mark-seen succeeded: clear the "+N" badge for the product. */
  | { type: "productSeen"; productId: string }
  /** Discovery stored new prospects: reset to page 1 / "all" and refetch. */
  | { type: "discoveryApplied" }
  /** Background agent finished: mark the product and refetch page 1 (filter kept). */
  | { type: "agentRunCompleted"; productId: string }
  /** Patch one lead on the current page only (enrichment, optimistic status). */
  | { type: "leadUpdated"; id: string; changes: Partial<Lead> }
  /** Restore a lead on the current page after a failed status update. */
  | { type: "leadStatusRollback"; lead: Lead }
  /** Patch a lead in both the current page and the funnel list. */
  | { type: "leadPatched"; id: string; changes: Partial<Lead> }
  /** Local edits of funnel fields (revenue/note inputs) before they are saved. */
  | { type: "outcomeLeadEdited"; id: string; changes: Partial<Lead> };

export function createInitialWorkspaceState(): WorkspaceState {
  return {
    // No products until the server says otherwise. The dashboard used to open
    // on a hardcoded demo product — "AI Characters", in Russian, from an
    // earlier project — which a new user could only read as their own. The
    // portfolio is empty until they add something.
    products: [],
    activeId: "",
    editing: blankProduct(),
    leads: [],
    leadTotal: 0,
    leadCounts: emptyLeadCounts,
    placementCounts: emptyPlacementCounts,
    outcomeLeads: [],
    newCount: 0,
    loadedLeadKey: "",
    leadRefresh: 0,
    discoveredProducts: {},
    leadPage: 1,
    leadModeFilter: "all",
    assignedFilter: "all",
    selectedLeadId: "",
  };
}

function patchList(list: Lead[], id: string, changes: Partial<Lead>): Lead[] {
  return list.map((item) => (item.id === id ? { ...item, ...changes } : item));
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "productsLoaded":
      return {
        ...state,
        products: action.products,
        activeId: action.initial.id,
        editing: action.initial,
      };
    case "filterRestored":
      return { ...state, leadModeFilter: action.filter };
    case "selectProduct":
      return {
        ...state,
        activeId: action.product.id,
        editing: action.product,
        leads: [],
        leadTotal: 0,
        leadCounts: emptyLeadCounts,
        placementCounts: emptyPlacementCounts,
        outcomeLeads: [],
        newCount: 0,
        selectedLeadId: "",
        leadPage: 1,
        leadModeFilter: "all",
        assignedFilter: "all",
      };
    case "editingChanged":
      return { ...state, editing: action.product };
    case "productSaved": {
      const exists = state.products.some((item) => item.id === action.product.id);
      return {
        ...state,
        products: exists
          ? state.products.map((item) =>
              item.id === action.product.id ? action.product : item,
            )
          : [action.product, ...state.products],
        activeId: action.product.id,
        editing: action.product,
      };
    }
    case "leadsPageLoaded": {
      const next = {
        ...state,
        leads: action.leads,
        leadTotal: action.total,
        leadCounts: action.counts,
        placementCounts: action.placementCounts,
        outcomeLeads: action.outcomeLeads,
        newCount: action.newCount,
        loadedLeadKey: action.requestKey,
      };
      const maxPage = Math.max(1, Math.ceil(action.total / leadsPerPage));
      // The requested page fell off the end (e.g. after deletions): clamp and
      // let the refetch effect repair the selection on the new page.
      if (state.leadPage > maxPage) return { ...next, leadPage: maxPage };
      if (!action.leads.some((lead) => lead.id === state.selectedLeadId)) {
        return { ...next, selectedLeadId: action.leads[0]?.id || "" };
      }
      return next;
    }
    case "leadsPageFailed":
      return { ...state, loadedLeadKey: action.requestKey };
    case "leadSelected":
      return { ...state, selectedLeadId: action.id };
    case "filterChanged":
      return {
        ...state,
        leadModeFilter: action.filter,
        leadPage: 1,
        selectedLeadId: "",
      };
    case "assignedFilterChanged":
      return {
        ...state,
        assignedFilter: action.filter,
        leadPage: 1,
        selectedLeadId: "",
      };
    case "pageChanged":
      return { ...state, leadPage: action.page };
    case "refreshRequested":
      return { ...state, leadRefresh: state.leadRefresh + 1 };
    case "productSeen":
      return {
        ...state,
        products: state.products.map((item) =>
          item.id === action.productId ? { ...item, newCount: 0 } : item,
        ),
      };
    case "markDiscovered":
      return {
        ...state,
        discoveredProducts: { ...state.discoveredProducts, [action.productId]: true },
      };
    case "discoveryApplied":
      return {
        ...state,
        leadPage: 1,
        leadModeFilter: "all",
        selectedLeadId: "",
        leadRefresh: state.leadRefresh + 1,
      };
    case "agentRunCompleted":
      return {
        ...state,
        discoveredProducts: { ...state.discoveredProducts, [action.productId]: true },
        leadPage: 1,
        selectedLeadId: "",
        leadRefresh: state.leadRefresh + 1,
      };
    case "leadUpdated":
      return { ...state, leads: patchList(state.leads, action.id, action.changes) };
    case "leadStatusRollback":
      return {
        ...state,
        leads: state.leads.map((item) =>
          item.id === action.lead.id ? action.lead : item,
        ),
      };
    case "leadPatched":
      return {
        ...state,
        leads: patchList(state.leads, action.id, action.changes),
        outcomeLeads: patchList(state.outcomeLeads, action.id, action.changes),
      };
    case "outcomeLeadEdited":
      return {
        ...state,
        outcomeLeads: patchList(state.outcomeLeads, action.id, action.changes),
      };
    default:
      return state;
  }
}
