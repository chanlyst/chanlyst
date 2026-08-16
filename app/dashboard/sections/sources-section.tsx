import type { Dispatch, SetStateAction } from "react";
import { sourceTones, sourceOptions, type Dictionary, type Locale } from "../i18n";
import type { BusyState, PipelineRun, Product } from "../types";
import RunProgress from "./run-progress";

/**
 * "Где искать": the source picker plus the discovery button. It opens the
 * channels page, right above the table its run fills in.
 */
export default function SourcesSection({
  t,
  locale,
  editing,
  sources,
  setSources,
  busy,
  discover,
  hasDiscovered,
  startPipeline,
  run,
}: {
  t: Dictionary;
  locale: Locale;
  editing: Product;
  sources: string[];
  setSources: Dispatch<SetStateAction<string[]>>;
  busy: BusyState;
  discover: () => Promise<void>;
  /** Whether this product has any discovered channel yet. */
  hasDiscovered: boolean;
  startPipeline: () => Promise<void>;
  /**
   * The run this panel's button started. The progress bar lives here rather
   * than pinned to the window: it belongs to the button that caused it, and
   * this is where the eye already is when the press produces no other change.
   */
  run: PipelineRun | null;
}) {
  return (
    <section className="panel sources" id="channels">
      <div className="section-head">
        <div>
          <div>
            <h2>{t.sources}</h2>
            <p>{editing.name}</p>
          </div>
        </div>
        {/* One way in, and one way to go further.
            
            This button used to say "Find channels" whatever the state, which
            made it a second start beside "Prepare everything" — and a narrower
            one, because it searches for places and skips the direct-buyer half
            entirely. People pressed the button next to the list, got half a
            result, and had no way to know the other half existed: that is why
            Outreach sat empty for weeks.

            Before anything is found it starts the whole run. After that it
            means "more", which is a real second action now that a repeat run
            rotates to the next analysed queries and reads further down. */}
        <div className="head-actions">
          {hasDiscovered ? (
            <button
              className="lime"
              title={t.searchDeeperHint}
              onClick={() => void discover()}
              disabled={busy === "discover"}
            >
              {busy === "discover" ? t.finding : t.searchDeeper}
            </button>
          ) : (
            <button
              className="lime"
              onClick={() => void startPipeline()}
              disabled={busy === "pipeline" || busy === "discover"}
            >
              {busy === "pipeline" ? t.pipelineStarting : `✦ ${t.pipelineRun}`}
            </button>
          )}
          <strong>{sources.length}</strong>
        </div>
      </div>
      <div className="source-grid">
        {sourceOptions.map(([key, labels]) => (
          <button
            key={key}
            className={`${sourceTones[key]}${sources.includes(key) ? " active" : ""}`}
            onClick={() =>
              setSources((current) =>
                current.includes(key)
                  ? current.filter((item) => item !== key)
                  : [...current, key],
              )
            }
          >
            <i>{sources.includes(key) ? "✓" : "+"}</i>
            <div>
              <strong>{labels[locale][0]}</strong>
              <small>{labels[locale][1]}</small>
            </div>
          </button>
        ))}
      </div>
      <RunProgress run={run} t={t} locale={locale} />
    </section>
  );
}
