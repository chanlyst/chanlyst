import type { BusyState, Lead } from "../types";
import type { Locale } from "../i18n";

export default function ContactsSection({
  locale,
  contacts,
  total,
  loading,
  selectedId,
  page,
  pageCount,
  choose,
  setPage,
  enrich,
  approve,
  busy,
}: {
  locale: Locale;
  contacts: Lead[];
  total: number;
  loading: boolean;
  selectedId: string;
  page: number;
  pageCount: number;
  choose: (lead: Lead) => void;
  setPage: (page: number) => void;
  enrich: (lead: Lead) => void;
  /**
   * The server refuses to send to a lead that nobody approved, and until this
   * button existed there was nowhere to approve one: contacts are not listed
   * among the channels, so «approve it over there» pointed at a page that
   * never showed them. Ten contacts sat at status `review` on production with
   * five verified addresses among them, unreachable.
   */
  approve: (id: string) => void;
  busy: BusyState;
}) {
  const verified = contacts.filter((lead) => lead.contactStatus === "verified_public").length;
  const ru = locale === "ru";
  return (
    <section className="contacts-panel" id="contacts">
      <header>
        <div>
          <small>{ru ? "БАЗА ДЛЯ АУТРИЧА" : "OUTREACH DATABASE"}</small>
          <h2>{ru ? "Компании и публичные контакты" : "Companies and public contacts"}</h2>
          <p>
            {ru
              ? "Отдельно от каналов: конкретные получатели, найденные через Serper и проверенные на официальных страницах."
              : "Separate from channels: concrete recipients found through Serper and checked on official pages."}
          </p>
        </div>
        <div className="contacts-summary">
          <span><strong>{loading ? "—" : total}</strong><small>{ru ? "компаний" : "companies"}</small></span>
          <span><strong>{loading ? "—" : verified}</strong><small>{ru ? "email на странице" : "emails on page"}</small></span>
        </div>
      </header>

      {loading ? (
        <p className="contacts-empty">{ru ? "Загружаю контакты…" : "Loading contacts…"}</p>
      ) : contacts.length === 0 ? (
        <div className="contacts-empty">
          <strong>{ru ? "Контактов пока нет" : "No contacts yet"}</strong>
          <p>
            {ru
              ? "Запустите «Подготовить всё» в продукте: сначала появятся 20–30 каналов, затем начнётся отдельное расширение базы компаний."
              : "Run “Prepare everything” on the product: it finds 20–30 channels first, then expands a separate company database."}
          </p>
          <a href="/dashboard/products">{ru ? "Открыть продукт" : "Open product"}</a>
        </div>
      ) : (
        <div className="contacts-list">
          {contacts.map((lead) => {
            const verifiedEmail = lead.contactStatus === "verified_public";
            return (
              <article
                key={lead.id}
                className={lead.id === selectedId ? "selected" : ""}
                onClick={() => choose(lead)}
              >
                <span className="contact-avatar">{lead.company.slice(0, 2).toUpperCase()}</span>
                <div>
                  <strong>{lead.company}</strong>
                  <small>{lead.domain}</small>
                </div>
                <p>{lead.description || lead.reason}</p>
                <div className={`contact-email ${verifiedEmail ? "verified" : "pending"}`}>
                  <strong>{lead.email || (ru ? "email не найден" : "email not found")}</strong>
                  <small>{verifiedEmail ? (ru ? "публичный · проверен" : "public · verified") : (ru ? "нужна проверка" : "needs research")}</small>
                </div>
                {/* The cell is always here, even when empty. Each row is its
                    own grid, so the tracks are measured per row: where the
                    button was missing the last track collapsed and the four
                    columns to its left spread into the space, by up to 90px.
                    The fixed track width in the stylesheet is what holds them
                    in line; this placeholder keeps every row the same shape. */}
                {/* One action at a time, naming the next step: find the
                    address, then approve the recipient, then it can be
                    written to. */}
                <span className="contact-action">
                  {!verifiedEmail ? (
                    <button
                      type="button"
                      disabled={busy === "enrich"}
                      onClick={(event) => {
                        event.stopPropagation();
                        enrich(lead);
                      }}
                    >
                      {ru ? "Искать контакт" : "Find contact"}
                    </button>
                  ) : lead.status === "approved" ? (
                    <em className="contact-approved">{ru ? "✓ Одобрен" : "✓ Approved"}</em>
                  ) : (
                    <button
                      type="button"
                      className="dark"
                      onClick={(event) => {
                        event.stopPropagation();
                        approve(lead.id);
                      }}
                    >
                      {ru ? "Одобрить" : "Approve"}
                    </button>
                  )}
                </span>
              </article>
            );
          })}
        </div>
      )}

      {pageCount > 1 && (
        <footer className="contacts-pagination">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
          <span>{page} / {pageCount}</span>
          <button disabled={page >= pageCount} onClick={() => setPage(page + 1)}>→</button>
        </footer>
      )}
    </section>
  );
}
