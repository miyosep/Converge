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
}: {
  active?: "workspace" | "demo" | "evidence";
  action?: ReactNode;
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
            href="/"
            aria-current={active === "workspace" ? "page" : undefined}
          >
            Workspace
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
  onConnect,
}: {
  busy: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="welcome">
      <section className="welcome-hero">
        <div className="welcome-copy">
          <p className="eyebrow">
            <span className="accent-dot" />
            LESS COORDINATING. MORE CONNECTING.
          </p>
          <h1>
            Different tastes.
            <br />
            One <em>good plan.</em>
          </h1>
          <p className="hero-description">
            Find a dinner everyone can agree on. Share your preferences
            privately, decide together, and approve exactly what gets spent.
          </p>
          <div className="hero-actions">
            <button className="primary" disabled={busy} onClick={onConnect}>
              {busy ? "Connecting…" : "Open your workspace"}
              <ArrowRight size={18} />
            </button>
            <Link className="secondary" href="/demo">
              Explore the demo
              <ArrowUpRight size={17} />
            </Link>
          </div>
          <p className="wallet-hint">
            <Wallet size={15} />
            Connect a browser wallet. Sign in with a message, free of charge.
          </p>
        </div>
        <GatheringIllustration />
      </section>
      <section className="how-it-works" aria-labelledby="how-it-works-title">
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
                "Review your interpreted preferences, then compare restaurants that fit the group's confirmed requirements.",
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
        <span>Test tokens · Sample restaurants · No real reservations</span>
      </div>
    </div>
  );
}
