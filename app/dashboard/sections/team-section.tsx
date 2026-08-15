import { useState } from "react";
import type { Dictionary } from "../i18n";
import type { BusyState, TeamData } from "../types";

export default function TeamSection({
  t,
  team,
  sessionUserId,
  busy,
  inviteMember,
  removeMember,
  revokeInvite,
  notify,
}: {
  t: Dictionary;
  team: TeamData;
  sessionUserId: string;
  busy: BusyState;
  /** Returns the shareable invite link on success, null on failure. */
  inviteMember: (email: string) => Promise<string | null>;
  removeMember: (userId: string) => Promise<void>;
  revokeInvite: (inviteId: string) => Promise<void>;
  notify: (text: string, type?: "success" | "error") => void;
}) {
  const [email, setEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const members = team.members || [];
  const invites = team.invites || [];
  const limit = team.limit || 1;
  const used = members.length + invites.length;
  const isOwner = team.role === "owner";
  const seatsLine = t.teamSeats
    .replace("{used}", String(used))
    // Unlimited workspaces carry a sentinel ceiling; show ∞ instead.
    .replace("{limit}", limit >= 1_000_000 ? "∞" : String(limit));

  async function submitInvite(event: React.FormEvent) {
    event.preventDefault();
    const url = await inviteMember(email.trim());
    if (url) {
      setEmail("");
      setInviteUrl(url);
    }
  }

  async function copyInviteUrl() {
    await navigator.clipboard.writeText(inviteUrl);
    notify(t.teamLinkCopied);
  }

  return (
    <section className="panel team-panel" id="team">
      <div className="section-head">
        <div><div><h2>{t.teamTitle}</h2><p>{t.teamHint}</p></div></div>
        <strong>{seatsLine}</strong>
      </div>
      <div className="team-list">
        {members.map((member) => (
          <div className="team-row" key={member.userId}>
            <span className="avatar">
              {(member.name || member.email || "?").slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{member.name || member.email}</strong>
              <small>{member.email}</small>
            </div>
            <em>{member.role === "owner" ? t.teamRoleOwner : t.teamRoleMember}</em>
            {isOwner &&
              member.role !== "owner" &&
              member.userId !== sessionUserId && (
                <button
                  className="outline"
                  disabled={busy === "team"}
                  onClick={() => void removeMember(member.userId)}
                >
                  {t.teamRemove}
                </button>
              )}
          </div>
        ))}
        {invites.map((invite) => (
          <div className="team-row pending" key={invite.id}>
            <span className="avatar">✉</span>
            <div>
              <strong>{invite.email}</strong>
              <small>{t.teamPending}</small>
            </div>
            <em>{t.teamRoleMember}</em>
            {isOwner && (
              <button
                className="outline"
                disabled={busy === "team"}
                onClick={() => void revokeInvite(invite.id)}
              >
                {t.teamRevoke}
              </button>
            )}
          </div>
        ))}
      </div>
      {isOwner ? (
        <>
          <form className="team-invite" onSubmit={submitInvite}>
            <label>
              <span>{t.teamInviteLabel}</span>
              <input
                type="email"
                value={email}
                placeholder="name@company.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <button
              className="dark"
              type="submit"
              disabled={busy === "team" || !email.trim()}
            >
              {busy === "team" ? t.teamInviting : t.teamInviteButton}
            </button>
          </form>
          {inviteUrl && (
            <div className="team-invite-link">
              <p>{t.teamInviteCreated}</p>
              <div>
                <input readOnly value={inviteUrl} onFocus={(event) => event.target.select()} />
                <button className="outline" onClick={() => void copyInviteUrl()}>
                  {t.teamCopyLink}
                </button>
              </div>
              <small>{t.teamInviteLinkHint}</small>
            </div>
          )}
          {used >= limit && (
            <p className="team-limit-note">{t.teamLimitReached}</p>
          )}
        </>
      ) : (
        <p className="team-limit-note">{t.teamOwnerOnly}</p>
      )}
    </section>
  );
}
