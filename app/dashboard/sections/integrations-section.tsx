import { useState } from "react";
import type { Dictionary } from "../i18n";
import type { BusyState, IntegrationData } from "../types";

export default function IntegrationsSection({
  t,
  configured,
  connected,
  busy,
  configureGmail,
}: {
  t: Dictionary;
  configured: NonNullable<IntegrationData["configuration"]>;
  connected: NonNullable<IntegrationData["integrations"]>;
  busy: BusyState;
  configureGmail: (clientId: string, clientSecret: string) => Promise<boolean>;
}) {
  // The credential fields are used only by this section, so they live here;
  // the parent handlers receive the values and the fields are cleared only
  // when a call succeeds (matching the previous root-level behavior).
  // The AI provider runs on a system key from the environment, so there is no
  // customer-facing key field for it at all.
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  return (
        <section className="panel integrations" id="integrations">
          <div className="section-head"><div><div><h2>{t.integrations}</h2><p>{t.integrationsHint}</p></div></div></div>
          <div className="integration-grid">
            <article className={!configured.gmail ? "gmail-setup-card" : ""}><span className="provider gmail">M</span><div><h3>Gmail</h3><p>{t.gmailText}</p><small>{connected.gmail?.accountLabel}</small>{!configured.gmail && <><code className="redirect-uri">Redirect URI: https://chanlyst.com/api/integrations/gmail/callback</code><div className="connect-form gmail-connect"><input placeholder="Google OAuth Client ID" value={googleClientId} onChange={(event) => setGoogleClientId(event.target.value)} /><input type="password" autoComplete="off" placeholder="Google OAuth Client Secret" value={googleClientSecret} onChange={(event) => setGoogleClientSecret(event.target.value)} /><button onClick={async () => { if (await configureGmail(googleClientId, googleClientSecret)) { setGoogleClientId(""); setGoogleClientSecret(""); } }} disabled={!googleClientId || !googleClientSecret || busy === "integration"}>{t.saveOauth}</button></div></>}</div>{connected.gmail ? <b className="connected">{t.connected}</b> : configured.gmail ? <a href="/api/integrations/gmail/start">{t.connect} Gmail</a> : <b>{t.needsSetup}</b>}</article>
          </div>
        </section>
  );
}
