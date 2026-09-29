"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  LockKeyhole,
  LogOut,
  Plus,
  Users,
  Wallet,
} from "lucide-react";
import { AppHeader } from "./product-ui";
import { categories } from "../../src/lib/catalog-options";
import type { GroupSummary } from "../../src/lib/group-view";

export function PlansOverview({
  wallet,
  groups,
  loading,
  error,
  busy,
  notice,
  onRetry,
  onSignOut,
}: {
  wallet: string;
  groups: GroupSummary[];
  loading: boolean;
  error: boolean;
  busy: boolean;
  notice: string;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  const empty = !loading && !error && groups.length === 0;
  const shortWallet = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  return (
    <div className="shell plans-shell">
      <AppHeader
        action={
          <button
            className="wallet-button"
            disabled={busy}
            onClick={onSignOut}
            aria-label={`Sign out of wallet ${shortWallet}`}
            title="Sign out"
          >
            <Wallet size={16} aria-hidden="true" /> {shortWallet}{" "}
            <LogOut size={15} aria-hidden="true" />
          </button>
        }
      />
      <main className="plans-main" id="main-content" tabIndex={-1}>
        <header className="plans-heading">
          <div>
            <h1>My plans</h1>
            <p>
              <em>Your people. Your next good memory.</em>
            </p>
          </div>
          {!empty && (
            <Link href="/group/new" className="primary plans-create">
              <Plus size={18} aria-hidden="true" /> New plan
            </Link>
          )}
        </header>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {loading ? (
          <section className="plans-feedback" role="status" aria-live="polite">
            <span className="plans-loading-mark" aria-hidden="true" />
            <h2>Bringing your plans together…</h2>
            <p>Your shared moments will be here in a moment.</p>
          </section>
        ) : error ? (
          <section className="plans-feedback" role="alert">
            <h2>We couldn’t load your plans.</h2>
            <p>Your saved plans are still there. Try loading them again.</p>
            <button className="secondary" onClick={onRetry}>
              Try again
            </button>
          </section>
        ) : empty ? (
          <section className="plans-first" aria-labelledby="first-plan-title">
            <div className="plans-first-copy">
              <h2 id="first-plan-title">
                Something good
                <br />
                starts with <em>a plan</em>
              </h2>
              <Link href="/group/new" className="primary plans-create">
                Start a plan <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </div>
            <div className="plans-first-photo">
              <img
                src="/images/converge-together.webp"
                alt="Friends spending time together around a table outdoors"
                width={1536}
                height={1024}
              />
              <div className="plans-photo-caption">
                <span>FROM ‘WE SHOULD.’</span>
                <strong>
                  To <em>‘see you there.’</em>
                </strong>
              </div>
            </div>
          </section>
        ) : (
          <section
            className="plans-collection"
            aria-labelledby="plans-collection-title"
          >
            <div className="plans-collection-heading">
              <h2 id="plans-collection-title">
                Your gatherings <span>{groups.length}</span>
              </h2>
              <p>Pick up where you left off.</p>
            </div>
            <div className="plans-grid">
              {groups.map((group) => {
                const date = new Date(group.startsAt);
                const options = { timeZone: group.timeZone };
                const status = group.locked
                  ? "Proposal saved"
                  : group.confirmedCount === group.targetMemberCount
                    ? "Preferences ready"
                    : "Gathering preferences";
                return (
                  <Link
                    className="plan-tile"
                    href={`/group/${encodeURIComponent(group.id)}`}
                    key={group.id}
                  >
                    <div className="plan-tile-top">
                      <span className="plan-category">
                        {categories[group.category ?? "restaurant"].label}
                      </span>
                      <span
                        className={`plan-state${group.locked ? " is-saved" : ""}`}
                      >
                        <span aria-hidden="true" />
                        {status}
                      </span>
                    </div>
                    <div className="plan-tile-body">
                      <div className="plan-date" aria-hidden="true">
                        <span>
                          {date.toLocaleDateString("en-US", {
                            ...options,
                            month: "short",
                          })}
                        </span>
                        <strong>
                          {date.toLocaleDateString("en-US", {
                            ...options,
                            day: "2-digit",
                          })}
                        </strong>
                      </div>
                      <div>
                        <h3>{group.name}</h3>
                        <p>
                          <CalendarDays size={14} aria-hidden="true" />
                          <time dateTime={group.startsAt}>
                            {date.toLocaleString("en-US", {
                              ...options,
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </time>
                        </p>
                        <span className="plan-timezone">{group.timeZone}</span>
                      </div>
                    </div>
                    <div className="plan-members">
                      <Users size={17} aria-hidden="true" />
                      <span>
                        {group.memberCount} of {group.targetMemberCount} joined
                      </span>
                      <span>{group.confirmedCount} confirmed</span>
                    </div>
                    <div className="plan-tile-bottom">
                      <span>Open plan</span>
                      <ArrowRight size={19} aria-hidden="true" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
        {empty && (
          <section
            className="plans-how"
            aria-label="How your plan comes together"
          >
            {[
              ["01", "Make it yours", "Choose what you’d like to do and when."],
              [
                "02",
                "Bring your people",
                "Invite friends to share what matters privately.",
              ],
              [
                "03",
                "Agree together",
                "Choose a place and approve your own share.",
              ],
            ].map(([number, title, text]) => (
              <div key={number}>
                <span className="plans-step-number">{number}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </section>
        )}
        <footer className="plans-footer">
          <span>
            <LockKeyhole size={15} aria-hidden="true" /> Your preferences stay
            yours.
          </span>
          <p>Invited to a plan? Open the link your friend shared.</p>
        </footer>
      </main>
    </div>
  );
}
