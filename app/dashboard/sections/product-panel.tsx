import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { sourceTones, sourceOptions, type Dictionary, type Locale } from "../i18n";
import type { BusyState, PipelineRun, Product } from "../types";
import RunProgress from "./run-progress";

type ZoomRect = { top: number; left: number; width: number; height: number };
type ZoomPhase = "from" | "open" | "settled";
type ZoomTarget<T> = { payload: T; rect: ZoomRect };

/** Product fields that hold plain text and are editable in the passport. */
type TextField =
  | "name"
  | "website"
  | "description"
  | "category"
  | "audience"
  | "negativeAudience"
  | "geography"
  | "languages"
  | "goal"
  | "monetizationModel"
  | "paidOffer"
  | "priceRange"
  | "paymentPoint"
  | "conversionEvent"
  | "attributionMethod"
  | "partnerTerms";

/**
 * Shared "zoom out of the tile" modal machinery: the dialog starts at the
 * tile's rectangle and grows to a centred window, while its content is laid
 * out at the FINAL width from the first frame so text never re-wraps
 * mid-flight. Phases: from → open (grow transition runs) → settled
 * (scrolling enabled).
 */
function useZoomModal<T>() {
  const [target, setTarget] = useState<ZoomTarget<T> | null>(null);
  const [phase, setPhase] = useState<ZoomPhase>("from");
  const [finalWidth, setFinalWidth] = useState(0);
  const [targetHeight, setTargetHeight] = useState(0);

  // The inner wrapper already sits at the final width inside the tile-sized
  // dialog, so scrollHeight is the exact fitted height.
  const measure = useCallback(() => {
    const dialog = document.querySelector<HTMLElement>(".motion-modal");
    setTargetHeight(dialog ? dialog.scrollHeight + 2 : 0);
  }, []);

  const open = useCallback(
    (payload: T, tile: HTMLElement) => {
      const rect = tile.getBoundingClientRect();
      setFinalWidth(Math.min(1100, window.innerWidth * 0.94));
      setTarget({
        payload,
        rect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
      });
      setPhase("from");
      // A timeout (not requestAnimationFrame) so the transition still arms
      // when the tab is backgrounded; 30ms is enough for a style flush.
      window.setTimeout(() => {
        measure();
        setPhase("open");
        window.setTimeout(() => setPhase("settled"), 340);
      }, 30);
    },
    [measure],
  );

  const close = useCallback(() => {
    setPhase("from");
    window.setTimeout(() => setTarget(null), 330);
  }, []);

  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [target, close]);

  const geometry =
    target && typeof window !== "undefined"
      ? phase !== "from"
        ? (() => {
            const width = finalWidth;
            const height = Math.min(
              Math.max(targetHeight, 320),
              window.innerHeight * 0.9,
            );
            return {
              top: (window.innerHeight - height) / 2,
              left: (window.innerWidth - width) / 2,
              width,
              height,
            };
          })()
        : target.rect
      : null;

  return { target, phase, finalWidth, geometry, open, close, measure };
}

export default function ProductPanel({
  t,
  locale,
  products,
  activeId,
  editing,
  setEditing,
  busy,
  chooseProduct,
  setNewOpen,
  saveProduct,
  analyzeProduct,
  runCompetitorGap,
  prefillFromWebsite,
  discoverForMotion,
  saveMonitoring,
  pipelineRun,
  startPipeline,
  resumePipeline,
  variant,
}: {
  t: Dictionary;
  locale: Locale;
  products: Product[];
  activeId: string;
  editing: Product;
  setEditing: (product: Product) => void;
  busy: BusyState;
  chooseProduct: (product: Product) => void;
  setNewOpen: (open: boolean) => void;
  saveProduct: (product?: Product) => Promise<boolean>;
  analyzeProduct: () => Promise<void>;
  runCompetitorGap: () => Promise<void>;
  prefillFromWebsite: () => Promise<void>;
  discoverForMotion: (motionId: string) => void;
  saveMonitoring: (enabled: boolean, sources: string[]) => Promise<void>;
  /** The current (or latest) «Подготовить всё» run for the active product. */
  pipelineRun: PipelineRun | null;
  startPipeline: () => Promise<void>;
  resumePipeline: () => Promise<void>;
  /**
   * Which half of the product surface this instance renders. The workspace
   * page owns the portfolio (product switching, the new-product tile), the
   * products page owns the product card (hero, passport chips, monitoring and
   * the strategy block). The passport modal is rendered by both, because both
   * halves can open it — the portfolio through a tile's expand button, the
   * product card through the hero chips.
   */
  variant: "portfolio" | "card";
}) {
  // A run that is still moving blocks a second «Подготовить всё» click; a
  // paused run is resumed through its own button in the progress card.
  const pipelineActive =
    pipelineRun?.status === "queued" ||
    pipelineRun?.status === "running" ||
    pipelineRun?.status === "paused";
  const monitoringEnabled = Boolean(editing.monitoringEnabled);
  const monitoringSources = editing.monitoringSources || [];
  // Motion tiles stay compact; clicking one zooms its details out of the
  // tile into a modal overlaying the whole interface.
  const motion = useZoomModal<{ id: string; index: number }>();
  // The product passport reuses the very same zoom animation.
  const passport = useZoomModal<string>();
  const [passportEdit, setPassportEdit] = useState(false);
  const [newCompetitor, setNewCompetitor] = useState("");
  // Only confirmed rivals are ever searched on, so the button stays disabled
  // until at least one exists — the run would otherwise be refused server-side
  // and cost the user a click to learn it.
  const confirmedCompetitors = (editing.analysis.competitors || []).filter(
    (item) => item.confirmed,
  ).length;

  /**
   * Competitors live inside the product's analysis, so a change is a product
   * save. Saved immediately rather than behind a button: confirming a name is
   * a one-click act and an unsaved confirmation is worse than none.
   */
  function setCompetitors(
    competitors: NonNullable<Product["analysis"]["competitors"]>,
  ) {
    const next = {
      ...editing,
      analysis: { ...editing.analysis, competitors },
    };
    setEditing(next);
    void saveProduct(next);
  }

  // Values as they were when edit mode was entered — «Отмена» restores them.
  const [passportSnapshot, setPassportSnapshot] = useState<Product | null>(null);

  const { measure: measurePassport, target: passportTarget } = passport;
  // Switching between read and edit mode changes the content height, so the
  // dialog has to be re-fitted around it.
  useEffect(() => {
    if (!passportTarget) return;
    const timer = window.setTimeout(() => measurePassport(), 20);
    return () => window.clearTimeout(timer);
  }, [passportEdit, passportTarget, measurePassport]);

  const motionNames: Record<string, string> = locale === "ru"
    ? {
        direct_sales: "Прямые B2B-продажи",
        partnerships: "Партнёрства",
        affiliates: "Affiliate",
        directories: "Каталоги и обзоры",
        creators: "Авторы и инфлюенсеры",
        communities: "Сообщества",
        content_seo: "Контент и SEO",
        paid_placements: "Платные размещения",
      }
    : {
        direct_sales: "Direct B2B sales",
        partnerships: "Partnerships",
        affiliates: "Affiliate",
        directories: "Directories and reviews",
        creators: "Creators and influencers",
        communities: "Communities",
        content_seo: "Content and SEO",
        paid_placements: "Paid placements",
      };

  const modalMotion = motion.target
    ? (editing.analysis.acquisitionMotions || []).find(
        (item) => item.id === motion.target?.payload.id,
      )
    : undefined;

  // Every passport field, in the order both modes render them.
  const productFields: [TextField, string, boolean][] = [
    ["name", t.name, false],
    ["website", t.website, false],
    ["description", t.description, true],
    ["category", t.category, false],
    ["audience", t.audience, true],
    ["negativeAudience", t.negative, true],
    ["geography", t.geography, false],
    ["languages", t.languages, false],
    ["goal", t.goal, false],
  ];
  const funnelFields: [TextField, string, boolean][] = [
    ["monetizationModel", t.monetizationModel, false],
    ["paidOffer", t.paidOffer, false],
    ["priceRange", t.priceRange, false],
    ["paymentPoint", t.paymentPoint, false],
    ["conversionEvent", t.conversionEvent, false],
    ["attributionMethod", t.attributionMethod, false],
    ["partnerTerms", t.partnerTerms, false],
  ];

  // The passport always shows the live draft for the active product, and the
  // stored record for any other tile.
  const passportProduct = passportTarget
    ? passportTarget.payload === activeId
      ? editing
      : products.find((item) => item.id === passportTarget.payload) || editing
    : null;

  function openPassport(productId: string, tile: HTMLElement, edit = false) {
    setPassportEdit(false);
    setPassportSnapshot(null);
    passport.open(productId, tile);
    if (edit) {
      const product =
        products.find((item) => item.id === productId) || editing;
      startPassportEdit(product);
    }
  }

  function startPassportEdit(product: Product) {
    // Editing always goes through the existing `editing` draft, so a passport
    // opened for another tile makes that product active first.
    if (product.id !== activeId) chooseProduct(product);
    setPassportSnapshot(product);
    setPassportEdit(true);
  }

  function cancelPassportEdit() {
    if (passportSnapshot) setEditing(passportSnapshot);
    setPassportEdit(false);
  }

  async function savePassport() {
    const saved = await saveProduct();
    if (saved) setPassportEdit(false);
  }

  function closePassport() {
    setPassportEdit(false);
    passport.close();
  }

  // Up to four filled funnel values, shown as chips in the hero.
  const heroChips = (
    [
      editing.monetizationModel,
      editing.priceRange,
      editing.paymentPoint,
      editing.conversionEvent,
    ] as string[]
  )
    .map((value) => (value || "").trim())
    .filter(Boolean);

  return (
    <>
        {/* The portfolio leads both pages now: on Products it is the first
            thing, so switching product happens before reading about one. */}
        {(variant === "portfolio" || variant === "card") && (
        <section className="portfolio panel" id="products">
          <div className="section-head">
            <div><div><h2>{t.productPortfolio}</h2><p>{t.productHint}</p></div></div>
            <strong>{products.length}</strong>
          </div>
          <div className="product-tabs">
            {products.map((product) => (
              <div key={product.id} className={`product-tab${product.id === activeId ? " active" : ""}`}>
                <button className="product-tab-main" onClick={() => chooseProduct(product)}>
                  <span>{product.name.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <strong>{product.name}{Boolean(product.newCount) && <em className="new-count-badge" title={t.monitoringNewBadge}>+{product.newCount}</em>}</strong>
                    <small>{product.description?.trim() || product.category || "Product"}</small>
                  </div>
                  <i>{product.id === activeId ? "✓" : "→"}</i>
                </button>
                <button
                  type="button"
                  className="product-tab-expand"
                  aria-haspopup="dialog"
                  aria-label={`${t.passportOpen}: ${product.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    openPassport(product.id, event.currentTarget);
                  }}
                >
                  ⤢
                </button>
              </div>
            ))}
            <button className="new-product" onClick={() => setNewOpen(true)}>＋<strong>{t.addProduct}</strong></button>
          </div>
        </section>
        )}


        {variant === "card" && (
        <section className="product-workspace panel" id="product-card">
          {/* The heading alone. The line under it used to list what the card
              holds — passport, strategy, monitoring — which the card itself
              says in full a few centimetres lower. */}
          <div className="section-head"><h2>{t.productCardTitle}</h2></div>
          <div className="product-title">
            {/* What the product is, on its own line across the whole panel.
                Squeezed into the column between the avatar and the buttons it
                wrapped onto a second line and pushed the name down with it. */}
            <small className="product-kicker" title={editing.category || t.newProduct}>
              {editing.category || t.newProduct}
            </small>
            <div className="big-avatar">{editing.name.slice(0, 2).toUpperCase() || "NP"}</div>
            <div className="product-body">
              <h2>{editing.name || t.newProduct}</h2>
              <p>{editing.analysis.summary || editing.description}</p>
              <div className="passport-chips">
                {heroChips.length > 0 ? (
                  heroChips.map((chip, index) => <span key={index}>{chip}</span>)
                ) : (
                  <>
                    <em>{t.passportEmpty}</em>
                    <button
                      type="button"
                      className="passport-chip-action"
                      aria-haspopup="dialog"
                      onClick={(event) =>
                        openPassport(editing.id, event.currentTarget, true)
                      }
                    >
                      {t.passportFill}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="hero-actions">
              {/* The headline automation. Analysis alone stays available as a
                  secondary action for people who only want the strategy. */}
              <button
                className="lime"
                onClick={() => void startPipeline()}
                disabled={busy === "pipeline" || pipelineActive}
              >
                {busy === "pipeline" ? t.pipelineStarting : `✦ ${t.pipelineRun}`}
              </button>
              <button className="outline" onClick={analyzeProduct} disabled={busy === "analyze"}>{busy === "analyze" ? t.analyzing : t.analyze}</button>
            </div>
          </div>
          <p className="pipeline-hint">{t.pipelineRunHint}</p>

          {/* The same bar the «Where to search» panel carries. The button that
              starts a run is here, so the answer to "did it start" has to be
              here as well — otherwise pressing it changes nothing on screen and
              you have to walk to another page to find out. */}
          <RunProgress run={pipelineRun} t={t} locale={locale} />

          {/* The run narrates itself in one place now — the bar along the
              bottom of the «Where to search» panel, which follows the same
              steps live. What used to stand here was a second telling of it:
              five rows with their own ticks, on a page you have to leave to
              watch the search anyway.

              Two states the bar cannot express stay, because they need a
              decision rather than a wait. A paused run is out of AI credit and
              only resumes when someone presses; a failed run has to say what
              went wrong. Neither belongs in a progress bar, which disappears
              the moment a run stops being live. */}
          {pipelineRun?.status === "paused" && (
            <div className="pipeline-card paused" id="pipeline">
              <div className="pipeline-paused">
                <p>
                  {pipelineRun.errorCode === "ai_credits_exhausted"
                    ? t.pipelinePaused
                    : pipelineRun.error || pipelineRun.errorCode}
                </p>
                <button
                  className="dark"
                  disabled={busy === "pipeline"}
                  onClick={() => void resumePipeline()}
                >
                  {t.pipelineResume}
                </button>
              </div>
            </div>
          )}
          {pipelineRun?.status === "failed" && (
            <div className="pipeline-card failed" id="pipeline">
              <p className="pipeline-note error">
                {t.pipelineFailed}: {pipelineRun.error || pipelineRun.errorCode}
              </p>
            </div>
          )}
          <div className="commercial-brief monitoring-block">
            <div className="commercial-title">
              <span>◉</span>
              <div>
                <h3>{t.monitoringTitle}</h3>
                <p>{t.monitoringHint}</p>
              </div>
              <button
                className={monitoringEnabled ? "outline" : "lime"}
                disabled={busy === "monitoring"}
                onClick={() =>
                  void saveMonitoring(!monitoringEnabled, monitoringSources)
                }
              >
                {monitoringEnabled ? t.monitoringDisable : t.monitoringEnable}
              </button>
            </div>
            {monitoringEnabled && (
              <>
                <p className="monitoring-sources-hint">{t.monitoringSourcesHint}</p>
                <div className="source-grid">
                  {sourceOptions.map(([key, labels]) => (
                    <button
                      key={key}
                      className={`${sourceTones[key]}${monitoringSources.includes(key) ? " active" : ""}`}
                      disabled={busy === "monitoring"}
                      onClick={() =>
                        void saveMonitoring(
                          true,
                          monitoringSources.includes(key)
                            ? monitoringSources.filter((item) => item !== key)
                            : [...monitoringSources, key],
                        )
                      }
                    >
                      <i>{monitoringSources.includes(key) ? "✓" : "+"}</i>
                      <div><strong>{labels[locale][0]}</strong><small>{labels[locale][1]}</small></div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="strategy">
            <article><small>{t.strategy}</small><p>{editing.analysis.summary || "—"}</p></article>
            <article><small>{t.bestOffer}</small><p>{editing.analysis.offer || "—"}</p></article>
            <article><small>{t.recommended}</small><div className="chips">{(editing.analysis.channelTypes || []).map((item) => <span key={item}>{item}</span>)}</div></article>
            {/* Competitors are a suggestion until the user says otherwise: the
                distribution gap searches on these names, and a wrong one sends
                the whole analysis after somebody else's audience. */}
            <article className="motion-plan">
              <small>{locale === "ru" ? "Приоритетные механики" : "Priority acquisition motions"}</small>
              <div>
                {(editing.analysis.acquisitionMotions || []).map((item, index) => (
                  <section key={item.id}>
                    <button
                      type="button"
                      className="motion-toggle"
                      aria-haspopup="dialog"
                      onClick={(event) =>
                        motion.open({ id: item.id, index }, event.currentTarget)
                      }
                    >
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <div>
                        <header><strong>{motionNames[item.id]}</strong><em>{item.score}/100</em></header>
                        <i><u style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }} /></i>
                        {/* The gist only. The first action, the signal timing
                            and the KPI are all in the modal this tile opens,
                            and printing them here made one card 542px tall —
                            four of those is why a page with five features felt
                            like twenty. */}
                        <p>{item.rationale}</p>
                      </div>
                      <span className="motion-caret" aria-hidden="true">⤢</span>
                    </button>
                  </section>
                ))}
                {!editing.analysis.acquisitionMotions?.length && (
                  <p>{locale === "ru" ? "Запустите анализ — Chanlyst сравнит механики привлечения и построит приоритетный план." : "Run analysis to compare acquisition motions and build a prioritized plan."}</p>
                )}
              </div>
            </article>
            <article className="competitors">
              <small>{t.competitors}</small>
              <p className="competitors-hint">{t.competitorsHint}</p>
              <div className="competitor-list">
                {(editing.analysis.competitors || []).map((item, index) => (
                  <span
                    key={`${item.domain}-${index}`}
                    className={item.confirmed ? "confirmed" : ""}
                  >
                    <b>{item.name}</b>
                    <i>{item.domain}</i>
                    {/* Labelled, not a "+". Beside a "×" in a list of items
                        that are already on screen, a plus reads as "add", and
                        nobody guesses it means "yes, this really is a rival" —
                        which left the check button disabled with no clue why. */}
                    <button
                      type="button"
                      className="competitor-confirm"
                      aria-pressed={Boolean(item.confirmed)}
                      title={item.confirmed ? t.competitorConfirmed : t.competitorConfirm}
                      onClick={() => setCompetitors(
                        (editing.analysis.competitors || []).map((row, position) =>
                          position === index ? { ...row, confirmed: !row.confirmed } : row,
                        ),
                      )}
                    >
                      {item.confirmed ? `✓ ${t.competitorConfirmedShort}` : t.competitorConfirm}
                    </button>
                    <button
                      type="button"
                      className="competitor-remove"
                      title={t.competitorRemove}
                      onClick={() => setCompetitors(
                        (editing.analysis.competitors || []).filter((_, position) => position !== index),
                      )}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {!(editing.analysis.competitors || []).length && (
                  <em className="competitors-empty">{t.competitorsEmpty}</em>
                )}
              </div>
              <form
                className="competitor-add"
                onSubmit={(event) => {
                  event.preventDefault();
                  const domain = newCompetitor
                    .trim()
                    .replace(/^https?:\/\//i, "")
                    .replace(/^www\./i, "")
                    .split("/")[0]
                    .toLowerCase();
                  if (!domain || !domain.includes(".")) return;
                  const existing = editing.analysis.competitors || [];
                  if (existing.some((row) => row.domain === domain)) {
                    setNewCompetitor("");
                    return;
                  }
                  // A name the user typed is confirmed by the act of typing it.
                  setCompetitors([
                    ...existing,
                    { name: domain.split(".")[0], domain, confirmed: true },
                  ]);
                  setNewCompetitor("");
                }}
              >
                <input
                  value={newCompetitor}
                  onChange={(event) => setNewCompetitor(event.target.value)}
                  placeholder={t.competitorPlaceholder}
                  aria-label={t.competitorPlaceholder}
                />
                <button type="submit" disabled={!newCompetitor.trim()}>{t.competitorAdd}</button>
              </form>
              {/* Manual on purpose: the check spends a search request per
                  channel per rival, more than the run that found the channels,
                  so it happens when asked and never on its own. */}
              <div className="gap-run">
                <button
                  className="outline"
                  disabled={busy === "competitorGap" || !confirmedCompetitors}
                  title={!confirmedCompetitors ? t.gapNoCompetitors : undefined}
                  onClick={() => void runCompetitorGap()}
                >
                  {busy === "competitorGap" ? t.gapRunning : t.gapRun}
                </button>
                <small>{t.gapHint}</small>
              </div>
            </article>
            {motion.target && modalMotion && motion.geometry &&
              createPortal(
                <div className={`motion-modal-layer${motion.phase !== "from" ? " open" : ""}${motion.phase === "settled" ? " settled" : ""}`}>
                  <div className="motion-modal-backdrop" onClick={motion.close} />
                  <div
                    className="motion-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-label={motionNames[modalMotion.id]}
                    style={motion.geometry}
                  >
                  <div
                    className="motion-modal-inner"
                    style={{ width: motion.finalWidth || undefined }}
                  >
                    <button
                      type="button"
                      className="motion-modal-close"
                      aria-label={t.close}
                      onClick={motion.close}
                    >
                      ×
                    </button>
                    <header className="motion-modal-head">
                      <b>{String(motion.target.payload.index + 1).padStart(2, "0")}</b>
                      <div>
                        <strong>{motionNames[modalMotion.id]}</strong>
                        <em>{modalMotion.score}/100</em>
                      </div>
                    </header>
                    <i className="motion-modal-score">
                      <u style={{ width: `${Math.max(0, Math.min(100, modalMotion.score))}%` }} />
                    </i>
                    <div className="motion-modal-body">
                      <p>{modalMotion.rationale}</p>
                      <footer>
                        <span>{locale === "ru" ? "Первый шаг" : "First action"}: {modalMotion.firstAction}</span>
                        <span>{locale === "ru" ? "Сигнал" : "Signal"}: {modalMotion.timeToSignal}</span>
                        <span>KPI: {modalMotion.kpi}</span>
                      </footer>
                      <button
                        type="button"
                        className="motion-find"
                        disabled={busy === "discover"}
                        onClick={() => {
                          motion.close();
                          discoverForMotion(modalMotion.id);
                        }}
                      >
                        {busy === "discover" ? t.finding : t.motionFindChannels}
                      </button>
                    </div>
                  </div>
                  </div>
                </div>,
                document.body,
              )}
          </div>
        </section>
        )}

        {passportTarget && passportProduct && passport.geometry &&
          createPortal(
            <div className={`motion-modal-layer${passport.phase !== "from" ? " open" : ""}${passport.phase === "settled" ? " settled" : ""}`}>
              <div className="motion-modal-backdrop" onClick={closePassport} />
              <div
                className="motion-modal"
                role="dialog"
                aria-modal="true"
                aria-label={`${t.productPassport}: ${passportProduct.name}`}
                style={passport.geometry}
              >
                <div
                  className="motion-modal-inner"
                  style={{ width: passport.finalWidth || undefined }}
                >
                  <button
                    type="button"
                    className="motion-modal-close"
                    aria-label={t.close}
                    onClick={closePassport}
                  >
                    ×
                  </button>
                  <header className="motion-modal-head">
                    <b>{passportProduct.name.slice(0, 2).toUpperCase() || "NP"}</b>
                    <div>
                      <strong>{passportProduct.name || t.newProduct}</strong>
                      <em>{t.productPassport}</em>
                    </div>
                    {!passportEdit && (
                      <button
                        type="button"
                        className="passport-edit"
                        onClick={() => startPassportEdit(passportProduct)}
                      >
                        {t.passportEditAction}
                      </button>
                    )}
                  </header>
                  <div className="passport-body">
                    {([
                      [t.passportProductSection, productFields],
                      [t.commercialBrief, funnelFields],
                    ] as [string, [TextField, string, boolean][]][]).map(
                      ([title, fields]) => (
                        <section key={title} className="passport-section">
                          <h4>{title}</h4>
                          <div className={passportEdit ? "passport-fields" : "passport-rows"}>
                            {fields.map(([field, label, multiline]) =>
                              passportEdit ? (
                                <label
                                  key={field}
                                  className={`${multiline ? "wide" : ""}${field === "negativeAudience" ? " danger-field" : ""}`}
                                >
                                  <span>{label}</span>
                                  {multiline ? (
                                    <textarea
                                      value={editing[field]}
                                      onChange={(event) =>
                                        setEditing({ ...editing, [field]: event.target.value })
                                      }
                                    />
                                  ) : (
                                    <input
                                      placeholder={field === "website" ? "https://…" : undefined}
                                      value={editing[field]}
                                      onChange={(event) =>
                                        setEditing({ ...editing, [field]: event.target.value })
                                      }
                                    />
                                  )}
                                </label>
                              ) : (
                                <div key={field} className="passport-row">
                                  <span>{label}</span>
                                  <p>{passportProduct[field]?.trim() || "—"}</p>
                                </div>
                              ),
                            )}
                          </div>
                        </section>
                      ),
                    )}
                  </div>
                  {passportEdit && (
                    <footer className="passport-actions">
                      {Boolean(editing.website.trim()) && (
                        <button className="outline" onClick={prefillFromWebsite} disabled={busy === "prefill"}>{busy === "prefill" ? t.prefillRunning : t.prefillButton}</button>
                      )}
                      <button className="outline" onClick={cancelPassportEdit}>{t.passportCancel}</button>
                      <button className="lime" onClick={() => void savePassport()}>{t.save}</button>
                    </footer>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )}
    </>
  );
}
