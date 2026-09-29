"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ConstraintSummary } from "./constraint-summary";
import { DiagnosticBadge, DiagnosticList } from "./diagnostics";
import { GroupNavigation } from "./workspace-frame";
import type { GroupSummary } from "../../src/lib/group-view";
import type {
  DiagnosticSeverity,
  DiagnosticSummary,
} from "../../src/lib/diagnostics/types";
import {
  ArrowRight,
  Check,
  Copy,
  Link2,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";

type Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
type Participant = {
  walletAddress: string;
  displayName: string;
  submitted: boolean;
  confirmed: boolean;
};
type Preference = {
  revisionId: string;
  rawText: string;
  status: string;
  extraction: unknown;
};

// Mirrors the shareable projection the API returns: no participant attribution,
// no internal detail.
type Reminder = {
  code: string;
  severity: DiagnosticSeverity;
  stage: string;
  retryable: boolean;
  title: string;
  guidance: string;
};

type ReminderPayload = {
  diagnostics?: Reminder[];
  summary?: DiagnosticSummary | null;
};

// Error responses carry the same reminder shape as success responses, which is
// what lets a failed action explain itself instead of showing a bare code.
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) {
    const failure = new Error(result.error ?? "REQUEST_FAILED") as Error & {
      reminders?: ReminderPayload;
    };
    failure.reminders = result;
    throw failure;
  }
  return result as T;
}

function remindersOf(payload: ReminderPayload | undefined): Reminder[] {
  return payload?.diagnostics ?? [];
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function GroupWorkspace({
  initialGroupId = "",
  mode = "home",
}: {
  initialGroupId?: string;
  mode?: "home" | "create" | "preferences";
}) {
  const [wallet, setWallet] = useState<string | null>(null);
  const [groupId, setGroupId] = useState(initialGroupId);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState(false);
  const [groupsRevision, setGroupsRevision] = useState(0);
  const [inviteToken, setInviteToken] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [preference, setPreference] = useState<Preference | null>(null);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [when, setWhen] = useState("");
  const [text, setText] = useState("");
  const [correction, setCorrection] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [reminderSummary, setReminderSummary] =
    useState<DiagnosticSummary | null>(null);
  const [revising, setRevising] = useState(false);
  const [groupLocked, setGroupLocked] = useState(false);

  const refresh = useCallback(async (id: string) => {
    const base = `/api/groups/${encodeURIComponent(id)}`;
    try {
      const [progress, own] = await Promise.all([
        api<
          ReminderPayload & {
            participants: Participant[];
            group: { locked: boolean };
          }
        >(`${base}/overview`),
        api<{ preference: Preference | null }>(`${base}/preferences`),
      ]);
      setParticipants(progress.participants);
      setGroupLocked(progress.group.locked);
      setPreference(own.preference);
      setText(own.preference?.rawText ?? "");
      setCorrection(
        own.preference?.extraction
          ? JSON.stringify(own.preference.extraction, null, 2)
          : "",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not load group",
      );
      setReminders(
        remindersOf((error as { reminders?: ReminderPayload }).reminders),
      );
    }
  }, []);

  // The progress poll refreshes the group's blockers on its own, so a stalled
  // group surfaces a reminder without anyone having to act.
  useEffect(() => {
    if (!wallet || !groupId) return;
    let active = true;
    const poll = () =>
      void api<ReminderPayload & { participants: Participant[] }>(
        `/api/groups/${encodeURIComponent(groupId)}/progress`,
      )
        .then((result) => {
          if (!active) return;
          setReminders(remindersOf(result));
          setReminderSummary(result.summary ?? null);
        })
        .catch(() => {});
    poll();
    const timer = window.setInterval(poll, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [wallet, groupId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invitedGroup =
      mode === "create" ? null : initialGroupId || params.get("group");
    if (invitedGroup) setGroupId(invitedGroup);
    setInviteToken(mode === "create" ? "" : (params.get("invite") ?? ""));
    api<{ walletAddress: string }>("/api/auth/session")
      .then((result) => setWallet(result.walletAddress))
      .catch(() => {});
  }, [initialGroupId, mode]);

  useEffect(() => {
    if (!wallet || mode !== "home") return;
    let active = true;
    setGroupsLoading(true);
    setGroupsError(false);
    void api<{ groups: GroupSummary[] }>("/api/groups")
      .then((result) => {
        if (active) setGroups(result.groups);
      })
      .catch(() => {
        if (active) setGroupsError(true);
      })
      .finally(() => {
        if (active) setGroupsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [wallet, mode, groupsRevision]);

  useEffect(() => {
    if (wallet && groupId) void refresh(groupId);
  }, [wallet, groupId, refresh]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Request failed");
      // A failed action replaces the standing reminders with the reason it
      // failed; a stale "waiting for others" note would contradict the error.
      const payload = (error as { reminders?: ReminderPayload }).reminders;
      if (payload) {
        setReminders(remindersOf(payload));
        setReminderSummary(payload.summary ?? null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    await run(async () => {
      if (!window.ethereum)
        throw new Error("Install a wallet extension to continue");
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No wallet selected");
      const challenge = await api<{ challengeId: string; message: string }>(
        "/api/auth/challenge",
        { address },
      );
      const signature = (await window.ethereum.request({
        method: "personal_sign",
        params: [challenge.message, address],
      })) as string;
      const session = await api<{ walletAddress: string }>("/api/auth/verify", {
        challengeId: challenge.challengeId,
        signature,
      });
      setWallet(session.walletAddress);
    });
  }

  async function createGroup() {
    await run(async () => {
      const timestamp = new Date(when);
      if (!Number.isFinite(timestamp.getTime()))
        throw new Error("Choose a date and time");
      const result = await api<{ groupId: string }>("/api/groups", {
        name,
        displayName,
        slot: {
          startsAt: timestamp.toISOString().replace(/\.\d{3}Z$/, "Z"),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      setGroupId(result.groupId);
      localStorage.setItem("converge:last-group", result.groupId);
      setNotice("Group created. Invite five others to join.");
      window.location.assign(`/group/${encodeURIComponent(result.groupId)}`);
    });
  }

  async function join() {
    await run(async () => {
      await api(`/api/groups/${encodeURIComponent(groupId)}/join`, {
        inviteToken,
        displayName,
      });
      localStorage.setItem("converge:last-group", groupId);
      await refresh(groupId);
      setNotice("You joined the group.");
    });
  }

  async function invite() {
    await run(async () => {
      const result = await api<{ token: string }>(
        `/api/groups/${encodeURIComponent(groupId)}/invite`,
        {},
      );
      const url = new URL(window.location.origin);
      url.searchParams.set("group", groupId);
      url.searchParams.set("invite", result.token);
      setInviteLink(url.toString());
    });
  }

  async function submit() {
    await run(async () => {
      const result = await api<{ preference: Preference }>(
        `/api/groups/${encodeURIComponent(groupId)}/preferences`,
        {
          text,
          expectedRevisionId: preference?.revisionId ?? null,
        },
      );
      setPreference(result.preference);
      setCorrection(JSON.stringify(result.preference.extraction, null, 2));
      setRevising(false);
      await refresh(groupId);
    });
  }

  async function correct() {
    if (!preference) return;
    await run(async () => {
      const result = await api<{ preference: Preference }>(
        `/api/groups/${encodeURIComponent(groupId)}/correct`,
        {
          expectedRevisionId: preference.revisionId,
          extraction: JSON.parse(correction),
        },
      );
      setPreference(result.preference);
      setRevising(false);
      await refresh(groupId);
    });
  }

  async function confirm() {
    if (!preference) return;
    await run(async () => {
      await api(`/api/groups/${encodeURIComponent(groupId)}/confirm`, {
        revisionId: preference.revisionId,
      });
      await refresh(groupId);
      setNotice("Your preferences are confirmed.");
    });
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Converge home">
          <span className="brand-mark">C</span>
          <span>Converge</span>
        </a>
        <div className="top-actions">
          <Link className="text-button" href="/evidence">
            Evidence
          </Link>
          <a className="text-button" href="/demo">
            Explore Demo
          </a>
          <span className="network">
            <span className="network-dot" /> Ethereum Sepolia
          </span>
          {wallet ? (
            <button
              className="wallet-button"
              type="button"
              onClick={() =>
                void run(async () => {
                  await api("/api/auth/logout", {});
                  setWallet(null);
                  setParticipants([]);
                  setPreference(null);
                })
              }
            >
              <Wallet size={16} /> {shortAddress(wallet)} <LogOut size={15} />
            </button>
          ) : (
            <button
              className="primary"
              type="button"
              onClick={() => void connect()}
              disabled={busy}
            >
              <Wallet size={16} /> Connect wallet
            </button>
          )}
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-label">WORKSPACE</div>
          <div className="nav-row active">
            <Users size={17} /> Group decision
          </div>
          <div className="sidebar-foot">
            <ShieldCheck size={18} />
            <span>
              Preferences stay visible only to their owner. Payment requires six
              separate approvals.
            </span>
          </div>
        </aside>
        <section className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">GROUP WORKSPACE</div>
              <h1>
                {groupId && participants.length
                  ? "Your preferences"
                  : mode === "create"
                    ? "Create a group"
                    : "Your groups"}
              </h1>
            </div>
            {wallet && groupId && participants.length > 0 && (
              <button
                className="icon-button"
                title="Refresh group"
                aria-label="Refresh group"
                onClick={() => void refresh(groupId)}
              >
                <RefreshCw size={18} />
              </button>
            )}
          </div>
          <p className="mode-description">
            Decide together with six independently controlled wallets. For a
            guided session with automated participants, use Explore Demo.
          </p>
          {groupId && <GroupNavigation id={groupId} active="preferences" />}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {wallet && groupId && reminders.length > 0 && (
            <DiagnosticList
              diagnostics={reminders}
              summary={reminderSummary}
              onRetry={() => void refresh(groupId)}
              onDismiss={() => {
                setReminders([]);
                setReminderSummary(null);
              }}
              isBusy={busy}
            />
          )}
          {!wallet && (
            <div className="empty-state">
              <Wallet size={27} />
              <h2>Connect your wallet</h2>
              <p>
                Sign a message to access your private group workspace. No
                transaction is required to sign in.
              </p>
              <button
                className="primary"
                onClick={() => void connect()}
                disabled={busy}
              >
                Connect wallet <ArrowRight size={16} />
              </button>
            </div>
          )}
          {wallet && groupId && inviteToken && participants.length === 0 && (
            <div className="section-block">
              <h2>Join the group</h2>
              <p>Choose the name your group will see.</p>
              <label>
                Display name
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={80}
                />
              </label>
              <button
                className="primary"
                onClick={() => void join()}
                disabled={busy || !displayName.trim()}
              >
                Join group <ArrowRight size={16} />
              </button>
            </div>
          )}
          {wallet && mode === "home" && !groupId && (
            <section>
              <div className="panel-heading">
                <h2>Your shared decisions</h2>
                <Link href="/group/new" className="primary flow-link">
                  <Plus size={16} />
                  Create group
                </Link>
              </div>
              {groupsLoading ? (
                <div className="flow-panel" role="status">
                  Loading your groups…
                </div>
              ) : groupsError ? (
                <div className="flow-panel" role="alert">
                  <h3>Couldn't load your groups</h3>
                  <p>Please try again.</p>
                  <button
                    className="secondary"
                    onClick={() => setGroupsRevision((value) => value + 1)}
                  >
                    Retry
                  </button>
                </div>
              ) : groups.length === 0 ? (
                <div className="flow-panel flow-empty">
                  <Users size={30} />
                  <h2>Your next decision starts here</h2>
                  <p>
                    Create a group, invite five others, and let everyone share
                    their requirements privately.
                  </p>
                  <Link className="primary flow-link" href="/group/new">
                    Create your first group <ArrowRight size={16} />
                  </Link>
                </div>
              ) : (
                <div className="group-card-grid">
                  {groups.map((group) => (
                    <Link
                      className="group-card"
                      key={group.id}
                      href={`/group/${encodeURIComponent(group.id)}`}
                    >
                      <span className="pill">
                        {group.locked
                          ? "Proposal saved"
                          : group.confirmedCount === 6
                            ? "Ready for evaluation"
                            : "Collecting preferences"}
                      </span>
                      <h3>{group.name}</h3>
                      <p>
                        {new Date(group.startsAt).toLocaleString("en-US", {
                          timeZone: group.timeZone,
                        })}
                        <br />
                        {group.timeZone}
                      </p>
                      <div className="panel-heading">
                        <span>
                          {group.memberCount} / 6 joined ·{" "}
                          {group.confirmedCount} confirmed
                        </span>
                        <ArrowRight size={19} />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}
          {wallet &&
            mode === "create" &&
            (!groupId || (participants.length === 0 && !inviteToken)) && (
              <div className="section-block">
                <h2>Create a decision</h2>
                <div className="form-grid">
                  <label>
                    Group name
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Saturday dinner"
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Your display name
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Alice"
                      maxLength={80}
                    />
                  </label>
                  <label>
                    Reservation time
                    <input
                      type="datetime-local"
                      value={when}
                      onChange={(e) => setWhen(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  className="primary"
                  onClick={() => void createGroup()}
                  disabled={
                    busy || !name.trim() || !displayName.trim() || !when
                  }
                >
                  <Plus size={16} /> Create group
                </button>
                {groupId && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setGroupId("");
                      localStorage.removeItem("converge:last-group");
                    }}
                  >
                    Start another group
                  </button>
                )}
              </div>
            )}
          {wallet && groupId && participants.length > 0 && (
            <div className="group-layout">
              <div className="main-column">
                <div className="section-block">
                  <div className="section-title">
                    <div>
                      <h2>Private preferences</h2>
                      <p>
                        Only you can see your original text and extracted
                        conditions.
                      </p>
                    </div>
                    <span className="state">
                      {preference?.status?.replaceAll("_", " ") ??
                        "NOT SUBMITTED"}
                    </span>
                  </div>
                  <label>
                    Your requirements
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={5}
                      maxLength={4000}
                      placeholder="Under $35 per person, quiet, near a subway station..."
                      disabled={
                        groupLocked ||
                        (preference?.status === "CONFIRMED" && !revising)
                      }
                    />
                  </label>
                  {!groupLocked &&
                    (preference?.status !== "CONFIRMED" || revising) && (
                      <button
                        className="primary"
                        onClick={() => void submit()}
                        disabled={busy || !text.trim()}
                      >
                        {preference
                          ? "Update & re-interpret"
                          : "Interpret preferences"}{" "}
                        <ArrowRight size={16} />
                      </button>
                    )}
                  {preference?.extraction != null && (
                    <ConstraintSummary value={preference.extraction} />
                  )}
                  {preference?.extraction != null &&
                    !groupLocked &&
                    (preference.status !== "CONFIRMED" || revising) && (
                      <div className="interpretation">
                        <h3>Review AI interpretation</h3>
                        <p>
                          Correct any field before confirming. Unresolved
                          requirements must be addressed.
                        </p>
                        <textarea
                          className="json-editor"
                          aria-label="Structured interpretation"
                          value={correction}
                          onChange={(e) => setCorrection(e.target.value)}
                          rows={13}
                          spellCheck={false}
                        />
                        <div className="button-row">
                          <button
                            className="secondary"
                            onClick={() => void correct()}
                            disabled={busy}
                          >
                            <RefreshCw size={15} /> Save correction
                          </button>
                          {preference.status !== "CONFIRMED" && (
                            <button
                              className="primary"
                              onClick={() => void confirm()}
                              disabled={busy}
                            >
                              <Check size={16} /> Confirm
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  {preference?.status === "CONFIRMED" && (
                    <div className="confirmed">
                      <Check size={17} /> Your interpretation is confirmed.
                    </div>
                  )}
                  {preference?.status === "CONFIRMED" &&
                    !groupLocked &&
                    !revising && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => setRevising(true)}
                      >
                        Revise my preferences
                      </button>
                    )}
                  {revising && (
                    <p className="flow-note">
                      Saving a revision clears your confirmation. Review and
                      confirm the new conditions before evaluation.
                    </p>
                  )}
                  {groupLocked && (
                    <p className="flow-note">
                      Your group's proposal is frozen. These preferences cannot
                      be changed for this decision.
                    </p>
                  )}
                  {preference?.status === "CONFIRMED" && (
                    <Link
                      className="text-button"
                      href={`/group/${encodeURIComponent(groupId)}/results`}
                    >
                      Continue to results →
                    </Link>
                  )}
                </div>
              </div>
              <div className="side-column">
                <div className="section-block">
                  <div className="section-title">
                    <h2>Participants</h2>
                    <strong>
                      {participants.filter((p) => p.confirmed).length} / 6
                    </strong>
                  </div>
                  <p>
                    {participants.filter((person) => person.submitted).length}{" "}
                    submitted ·{" "}
                    {participants.filter((person) => person.confirmed).length}{" "}
                    confirmed
                  </p>
                  <DiagnosticBadge
                    diagnostics={reminders}
                    summary={reminderSummary}
                  />
                  <div className="participant-list">
                    {participants.map((person) => (
                      <div className="participant" key={person.walletAddress}>
                        <span className="avatar">
                          {person.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="person-name">
                          {person.displayName}
                          <small>{shortAddress(person.walletAddress)}</small>
                        </span>
                        <span
                          className={`person-status ${person.confirmed ? "done" : ""}`}
                        >
                          {person.confirmed
                            ? "Confirmed"
                            : person.submitted
                              ? "Submitted"
                              : "Waiting"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    className="secondary full"
                    onClick={() => void invite()}
                    disabled={busy || participants.length >= 6}
                  >
                    <Link2 size={16} /> Create invite link
                  </button>
                  {inviteLink && (
                    <div className="invite-link">
                      <input
                        aria-label="Invite link"
                        readOnly
                        value={inviteLink}
                      />
                      <button
                        className="icon-button"
                        title="Copy invite link"
                        aria-label="Copy invite link"
                        onClick={() =>
                          void navigator.clipboard.writeText(inviteLink)
                        }
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
