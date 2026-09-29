import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Users,
  Wallet,
  UserRound,
  Flower2,
} from "lucide-react";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Converge home">
      <svg
        className="brand-symbol"
        viewBox="0 0 36 36"
        fill="none"
        aria-hidden="true"
      >
        <path d="M7 10h9v9H7zM20 17h9v9h-9z" fill="currentColor" />
        <path
          d="m16 10 13 16M7 19l13-2"
          stroke="currentColor"
          strokeWidth="3"
        />
      </svg>
      <span>
        converge<span className="brand-period">.</span>
      </span>
    </Link>
  );
}

export function AppHeader({
  active = "workspace",
  action,
  publicView = false,
}: {
  active?: "workspace" | "demo" | "evidence";
  action?: ReactNode;
  publicView?: boolean;
}) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="topbar">
        <Brand />
        <nav className="main-nav" aria-label="Main navigation">
          <Link
            href={publicView ? "#how-it-works" : "/"}
            aria-current={
              !publicView && active === "workspace" ? "page" : undefined
            }
          >
            {publicView ? "How it works" : "Workspace"}
          </Link>
          <Link
            href="/demo"
            aria-current={active === "demo" ? "page" : undefined}
          >
            Explore demo
          </Link>
          <Link
            href="/evidence"
            aria-current={active === "evidence" ? "page" : undefined}
          >
            Evidence
          </Link>
        </nav>
        <div className="top-actions">
          <span className="network">
            <span className="network-dot" />
            Sepolia testnet
          </span>
          {action}
        </div>
      </header>
    </>
  );
}

export function GatheringIllustration() {
  return (
    <div className="gathering-art" aria-hidden="true">
      <div className="art-label">
        <span /> A SEAT FOR EVERY VOICE
      </div>
      <div className="table-scene">
        <div className="table-orbit" />
        <div className="dinner-table">
          <Flower2 className="table-flower" size={24} strokeWidth={1.3} />
          <span>
            better
            <br />
            <em>together.</em>
          </span>
          <span className="table-place place-one" />
          <span className="table-place place-two" />
          <span className="table-place place-three" />
          <span className="table-place place-four" />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <span className={`table-seat seat-${i + 1}`} key={i}>
            <UserRound size={19} strokeWidth={1.5} />
          </span>
        ))}
        <div className="art-tag tag-private">
          <LockKeyhole size={14} />
          Private preferences
        </div>
        <div className="art-tag tag-shared">
          <ShieldCheck size={14} />
          Shared approval
        </div>
      </div>
      <div className="art-caption">
        <span>
          Different perspectives.
          <br />
          One place to meet.
        </span>
        <ArrowUpRight size={28} strokeWidth={1.3} />
      </div>
    </div>
  );
}

export function WelcomeWorkspace({
  busy,
  loading = false,
  notice = "",
  invited = false,
  onConnect,
}: {
  busy: boolean;
  loading?: boolean;
  notice?: string;
  invited?: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="welcome">
      <section className="landing-hero" aria-labelledby="welcome-title">
        <img
          className="landing-visual"
          src="/images/converge-orbit.webp"
          alt=""
          fetchPriority="high"
          width={1672}
          height={941}
        />
        <div className="landing-shade" aria-hidden="true" />
        <div className="landing-copy">
          <p className="landing-eyebrow">
            <span className="accent-dot" /> DIFFERENT PEOPLE. SHARED
            POSSIBILITIES.
          </p>
          <h1 id="welcome-title">
            Every voice.
            <br />
            <em>One shared plan.</em>
          </h1>
          <p className="landing-description">
            Bring your people together. Converge turns private preferences into
            a plan everyone can approve — from dinner and weekend stays to
            spaces, sports and new experiences.
          </p>
          <div className="landing-actions">
            <button
              className="primary"
              disabled={busy || loading}
              onClick={onConnect}
            >
              <Wallet size={18} aria-hidden="true" />
              {loading
                ? "Checking your session…"
                : busy
                  ? "Connecting…"
                  : "Connect wallet"}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            <a className="landing-secondary" href="#how-it-works">
              Discover Converge <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </div>
          <p className="landing-login-hint">
            Your wallet is your sign-in. A message signature, no payment.
          </p>
          {invited && (
            <p className="landing-invitation">
              Your group is waiting. Sign in to continue with your invitation.
            </p>
          )}
          <div className="landing-status" role="status" aria-live="polite">
            {notice}
          </div>
        </div>
        <div className="landing-bottom">
          <span>AI proposes. Humans approve.</span>
          <a href="#how-it-works">
            A better way to decide <span aria-hidden="true">↓</span>
          </a>
        </div>
      </section>
      <section
        id="how-it-works"
        className="how-it-works"
        aria-labelledby="how-it-works-title"
      >
        <div className="section-intro">
          <p className="eyebrow">
            A LITTLE STRUCTURE. A LOT LESS BACK-AND-FORTH.
          </p>
          <h2 id="how-it-works-title">
            From “where should we go?”
            <br />
            to a plan you all approve.
          </h2>
          <p>
            AI helps with the options.
            <br />
            Your group makes the call.
          </p>
        </div>
        <div className="how-grid">
          {[
            {
              number: "01",
              Icon: MessageSquareText,
              title: "Say what matters",
              description:
                "Choose your group size, invite your people, and share your budget, tastes, and requirements. Your original preferences stay private.",
            },
            {
              number: "02",
              Icon: Users,
              title: "Find your common ground",
              description:
                "Review your interpreted preferences, then compare places and experiences that fit the group's confirmed requirements.",
            },
            {
              number: "03",
              Icon: ShieldCheck,
              title: "Approve. Then act.",
              description:
                "Everyone reviews the same spending terms. The group wallet can only pay within the approved policy.",
            },
          ].map(({ number, Icon, title, description }) => (
            <article className="how-card" key={number}>
              <div className="how-card-top">
                <Icon size={23} strokeWidth={1.5} />
                <span>{number}</span>
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
      <div className="workspace-footnote">
        <span>
          <span className="network-dot" />A working prototype on Ethereum
          Sepolia
        </span>
        <span>Test tokens · Sample venues · No real reservations</span>
      </div>
    </div>
  );
}
