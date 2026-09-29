"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ConstraintSummary } from "./constraint-summary";
import { GroupNavigation } from "./workspace-frame";
import { LeaveGroupButton } from "./leave-group-button";
import { AppHeader, WelcomeWorkspace } from "./product-ui";
import { getMetaMaskProvider } from "../../src/lib/browser-wallet";
import {
  connectWalletAccount,
  signWalletLogin,
  walletConnectionError,
} from "../../src/lib/wallet-connection";
import { DiagnosticsList } from "./diagnostics";
import { groupDiagnostics } from "../../src/lib/diagnostics/group";
import { diagnosticMessage } from "../../src/lib/diagnostics/errors";
import type { PublicDiagnostic } from "../../src/lib/diagnostics/types";
import type { GroupOverview, GroupSummary } from "../../src/lib/group-view";
import { RESTAURANT_IDS } from "../../src/lib/group-conditions";
import { RestaurantPicker } from "./restaurant-picker";
import {
  groupSizeSchema,
  MIN_GROUP_MEMBERS,
  MAX_GROUP_MEMBERS,
} from "../../src/lib/group-size";
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
  if (!response.ok) throw new Error(result.error ?? "REQUEST_FAILED");
  return result as T;
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

  const [sessionLoading, setSessionLoading] = useState(true);
  const [groupId, setGroupId] = useState(initialGroupId);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState(false);
  const [groupsRevision, setGroupsRevision] = useState(0);
  const [inviteToken, setInviteToken] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [diagnostics, setDiagnostics] = useState<PublicDiagnostic[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [preference, setPreference] = useState<Preference | null>(null);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [when, setWhen] = useState("");
  const [sizeInput, setSizeInput] = useState("4");
  const [targetMemberCount, setTargetMemberCount] = useState<number | null>(
    null,
  );
  const validSize = groupSizeSchema.safeParse(Number(sizeInput)).success;
  const [permittedRestaurantIds, setPermittedRestaurantIds] = useState<
    string[]
  >([...RESTAURANT_IDS]);
  const [text, setText] = useState("");
  const [correction, setCorrection] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [revising, setRevising] = useState(false);
  const [groupLocked, setGroupLocked] = useState(false);

  const refresh = useCallback(async (id: string) => {
    const base = `/api/groups/${encodeURIComponent(id)}`;
    try {
      const [progress, own] = await Promise.all([
        api<GroupOverview>(`${base}/overview`),
        api<{ preference: Preference | null }>(`${base}/preferences`),
      ]);
      setDiagnostics(groupDiagnostics(progress).diagnostics);
      setParticipants(progress.participants);
      setGroupLocked(progress.group.locked);
      setTargetMemberCount(progress.group.targetMemberCount);
      setPreference(own.preference);
      setText(own.preference?.rawText ?? "");
      setCorrection(
        own.preference?.extraction
          ? JSON.stringify(own.preference.extraction, null, 2)
          : "",
      );
    } catch (error) {
      setDiagnostics([]);
      setNotice(
        error instanceof Error
          ? (diagnosticMessage(error.message) ??
              "Could not load group. Refresh to try again.")
          : "Could not load group",
      );
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invitedGroup =
      mode === "create" ? null : initialGroupId || params.get("group");
    if (invitedGroup) setGroupId(invitedGroup);
    setInviteToken(mode === "create" ? "" : (params.get("invite") ?? ""));
    api<{ walletAddress: string }>("/api/auth/session")
      .then((result) => setWallet(result.walletAddress))
      .catch(() => {})
      .finally(() => setSessionLoading(false));
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
      setNotice(
        (error instanceof Error ? diagnosticMessage(error.message) : null) ??
          walletConnectionError(error),
      );
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    await run(async () => {
      const provider = await getMetaMaskProvider();
      if (!provider) return;
      setNotice("Open MetaMask to approve the connection and Sepolia network.");
      const address = await connectWalletAccount(provider);
      const challenge = await api<{ challengeId: string; message: string }>(
        "/api/auth/challenge",
        { address },
      );
      setNotice(
        "Confirm the sign-in message in MetaMask. If no popup appears, open MetaMask.",
      );
      const signature = await signWalletLogin(
        provider,
        challenge.message,
        address,
      );
      const session = await api<{ walletAddress: string }>("/api/auth/verify", {
        challengeId: challenge.challengeId,
        signature,
      });
      setWallet(session.walletAddress);
      setNotice("");
    });
  }

  async function createGroup() {
    await run(async () => {
      if (!validSize)
        throw new Error(
          `Choose a whole number from ${MIN_GROUP_MEMBERS} to ${MAX_GROUP_MEMBERS}.`,
        );
      const timestamp = new Date(when);
      if (!Number.isFinite(timestamp.getTime()))
        throw new Error("Choose a date and time");
      const result = await api<{ groupId: string }>("/api/groups", {
        name,
        displayName,
        targetMemberCount: Number(sizeInput),
        permittedRestaurantIds,
        slot: {
          startsAt: timestamp.toISOString().replace(/\.\d{3}Z$/, "Z"),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      setGroupId(result.groupId);
      localStorage.setItem("converge:last-group", result.groupId);
      setNotice(
        `Group created. Invite ${Number(sizeInput) - 1} others to join.`,
      );
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

  const welcome = !wallet && !groupId && mode === "home";
  const hasUnsavedCorrection =
    !!preference?.extraction &&
    correction !== JSON.stringify(preference.extraction, null, 2);
  return (
    <div className="shell">
      <AppHeader
        action={
          wallet ? (
            <button
              className="wallet-button"
              type="button"
              aria-label={`Sign out of wallet ${shortAddress(wallet)}`}
              title="Sign out"
              onClick={() =>
                void run(async () => {
                  await api("/api/auth/logout", {});
                  setWallet(null);
                  setParticipants([]);
                  setPreference(null);
                })
              }
            >
              <Wallet size={16} aria-hidden="true" /> {shortAddress(wallet)}{" "}
              <LogOut size={15} aria-hidden="true" />
            </button>
          ) : (
            <button
              className="wallet-button"
              type="button"
              onClick={() => void connect()}
              disabled={busy || sessionLoading}
            >
              <Wallet size={16} aria-hidden="true" />{" "}
              {busy ? "Connecting…" : "Connect wallet"}
            </button>
          )
        }
      />
      <div className={`workspace ${welcome ? "welcome-workspace" : ""}`}>
        {!welcome && (
          <aside className="sidebar">
            <div className="sidebar-label">YOUR SPACE</div>
            <nav aria-label="Workspace navigation">
              <Link
                className={`nav-row ${mode !== "create" ? "active" : ""}`}
                href="/"
                aria-current={mode !== "create" ? "page" : undefined}
              >
                <Users size={18} />
                Your groups
              </Link>
              <Link
                className={`nav-row ${mode === "create" ? "active" : ""}`}
                href="/group/new"
                aria-current={mode === "create" ? "page" : undefined}
              >
                <Plus size={18} />
                New group
              </Link>
            </nav>
            <div className="sidebar-foot">
              <ShieldCheck size={18} />
              <span>
                Preferences stay visible only to their owner. Payment requires
                every participant's approval.
              </span>
            </div>
          </aside>
        )}
        <main className="content" id="main-content" tabIndex={-1}>
          {!welcome && (
            <>
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
                {mode === "create"
                  ? "Choose your group size and invite your people to decide together."
                  : groupId
                    ? "Your voice stays private. Your group moves forward together."
                    : "Your people, your preferences, your next shared plan."}
              </p>
            </>
          )}
          {groupId && <GroupNavigation id={groupId} active="preferences" />}
          {wallet && groupId && participants.length > 0 && (
            <DiagnosticsList diagnostics={diagnostics} />
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          {sessionLoading ? (
            <div className="session-loading" role="status">
              Opening your workspace…
            </div>
          ) : welcome ? (
            <WelcomeWorkspace busy={busy} onConnect={() => void connect()} />
          ) : (
            !wallet && (
              <div className="empty-state">
                <Wallet size={27} />
                <h2>
                  {groupId
                    ? "Your group is waiting"
                    : "Let's get your group together"}
                </h2>
                <p>
                  Sign a message to access your private group workspace. No
                  transaction is required to sign in.
                </p>
                <button
                  className="primary"
                  onClick={() => void connect()}
                  disabled={busy}
                >
                  {busy ? "Connecting…" : "Connect wallet to continue"}{" "}
                  <ArrowRight size={16} />
                </button>
              </div>
            )
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
                    Create a group, invite your people, and let everyone share
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
                          : group.confirmedCount === group.targetMemberCount
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
                          {group.memberCount} / {group.targetMemberCount} joined
                          · {group.confirmedCount} confirmed
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
                  <label>
                    Group size, including you
                    <input
                      type="number"
                      min={MIN_GROUP_MEMBERS}
                      max={MAX_GROUP_MEMBERS}
                      step={1}
                      value={sizeInput}
                      onChange={(event) => setSizeInput(event.target.value)}
                      aria-describedby="group-size-help"
                      aria-invalid={!validSize}
                    />
                    <small id="group-size-help">
                      {validSize
                        ? `Invite ${Number(sizeInput) - 1} others. Everyone must confirm before recommendations are ready.`
                        : `Enter a whole number from ${MIN_GROUP_MEMBERS} to ${MAX_GROUP_MEMBERS}.`}
                    </small>
                  </label>
                </div>
                <p className="flow-note">
                  Groups of {MIN_GROUP_MEMBERS}–{MAX_GROUP_MEMBERS} can collect
                  preferences, compare restaurants and approve a shared test
                  payment. The Explore demo uses six participants.
                </p>
                <RestaurantPicker
                  selected={permittedRestaurantIds}
                  onChange={setPermittedRestaurantIds}
                />
                <button
                  className="primary"
                  onClick={() => void createGroup()}
                  disabled={
                    busy ||
                    !name.trim() ||
                    !displayName.trim() ||
                    !when ||
                    !validSize ||
                    permittedRestaurantIds.length === 0
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
                        <details className="advanced-editor">
                          <summary>
                            Advanced: edit structured conditions
                          </summary>
                          <p>
                            Prefer plain language? Update your requirements
                            above and select “Update & re-interpret”.
                          </p>
                          <textarea
                            className="json-editor"
                            aria-label="Structured interpretation"
                            value={correction}
                            onChange={(e) => setCorrection(e.target.value)}
                            rows={13}
                            spellCheck={false}
                          />
                          <button
                            className="secondary"
                            onClick={() => void correct()}
                            disabled={busy}
                          >
                            <RefreshCw size={15} /> Save correction
                          </button>
                        </details>
                        {hasUnsavedCorrection && (
                          <p role="status" className="flow-note">
                            Save your structured correction before confirming
                            these preferences.
                          </p>
                        )}
                        <div className="button-row">
                          {preference.status !== "CONFIRMED" && (
                            <button
                              className="primary"
                              onClick={() => void confirm()}
                              disabled={busy || hasUnsavedCorrection}
                            >
                              <Check size={16} /> Confirm my preferences
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
                      {participants.filter((p) => p.confirmed).length} /{" "}
                      {targetMemberCount ?? "—"}
                    </strong>
                  </div>
                  <p>
                    {participants.filter((person) => person.submitted).length}{" "}
                    submitted ·{" "}
                    {participants.filter((person) => person.confirmed).length}{" "}
                    confirmed
                  </p>
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
                    disabled={
                      busy ||
                      groupLocked ||
                      targetMemberCount === null ||
                      participants.length >= targetMemberCount
                    }
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
                          void run(async () => {
                            await navigator.clipboard.writeText(inviteLink);
                            setNotice(
                              "Invite link copied. Share it with the people joining your group.",
                            );
                          })
                        }
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  )}
                  <div className="flow-note">
                    <LeaveGroupButton groupId={groupId} locked={groupLocked} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
