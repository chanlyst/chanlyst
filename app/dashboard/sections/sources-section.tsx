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
  run,
}: {
  t: Dictionary;
  locale: Locale;
  editing: Product;
  sources: string[];
  setSources: Dispatch<SetStateAction<string[]>>;
  busy: BusyState;
  discover: () => Promise<void>;
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
        <div className="head-actions">
          <button
            className="lime"
            onClick={() => void discover()}
            disabled={busy === "discover"}
          >
            {busy === "discover" ? t.finding : t.find}
          </button>
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
