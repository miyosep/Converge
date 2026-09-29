import { PlanPreview } from "./plan-preview";
import { BrandMark } from "./brand-mark";
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
  BedDouble,
  Building2,
  Trophy,
  Palette,
  Utensils,
  CalendarDays,
} from "lucide-react";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Converge home">
      <BrandMark className="brand-symbol" />
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
  active?: "workspace" | "demo" | "evidence" | "discover";
  action?: ReactNode;
  publicView?: boolean;
}) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className={`topbar${publicView ? " floating-topbar" : ""}`}>
        <Brand />
        <nav className="main-nav" aria-label="Main navigation">
          <Link
            href="/discover"
            aria-current={active === "discover" ? "page" : undefined}
          >
            Find places
          </Link>
          <Link
            href={publicView ? "#how-it-works" : "/"}
            aria-current={
              !publicView && active === "workspace" ? "page" : undefined
            }
          >
            {publicView ? "How it works" : "My plans"}
          </Link>
          <Link
            href="/demo"
            aria-current={active === "demo" ? "page" : undefined}
          >
            Explore demo
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
    <div className="welcome consumer-welcome">
      <section className="human-hero sky-hero" aria-labelledby="welcome-title">
        <img
          className="sky-hero-image"
          src="/images/converge-city-sky.webp"
          alt=""
          width={1672}
          height={941}
          fetchPriority="high"
        />
        <div className="sky-hero-wash" aria-hidden="true" />
        <div className="human-copy">
          <h1 id="welcome-title">
            Less planning.
            <br />
            <em>More together.</em>
          </h1>
          <p className="human-description">
            Good food. A weekend away. Something new.
            <br />
            Share what matters privately. Find a plan everyone enjoys.
          </p>
          <div className="human-actions">
            <button
              className="primary"
              disabled={busy || loading}
              onClick={onConnect}
            >
              {loading
                ? "Checking your session…"
                : busy
                  ? "Connecting…"
                  : invited
                    ? "Join your friends"
                    : "Start a plan"}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            <Link className="human-demo" href="/demo">
              Try the demo <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <p className="human-signin">
            Sign in with MetaMask. No payment to get started.
          </p>
          {invited && (
            <p className="landing-invitation">
              Your group is waiting. Sign in to continue with your invitation.
            </p>
          )}
          <div role="status" aria-live="polite">
            {notice}
          </div>
          <div className="human-assurance">
            <span className="human-assurance-icon" aria-hidden="true">
              <LockKeyhole size={18} />
            </span>
            <div className="human-assurance-copy">
              <strong>Your preferences stay private.</strong>
              <span>
                Friends see the shared plan, not your individual answers.
              </span>
            </div>
          </div>
        </div>
        <a className="sky-scroll-cue" href="#product-preview">
          See how a plan comes together <span aria-hidden="true">↓</span>
        </a>
      </section>
      <section
        id="product-preview"
        className="product-preview-section"
        aria-labelledby="product-preview-heading"
      >
        <div className="product-preview-intro">
          <p className="eyebrow">A LITTLE LESS “WHAT WORKS FOR EVERYONE?”</p>
          <h2 id="product-preview-heading">
            Different wishes.
            <br />
            One shared plan.
          </h2>
          <p>
            Pick an example. See how your preferences become a plan you can all
            approve.
          </p>
        </div>
        <PlanPreview />
      </section>
      <section className="occasion-strip" aria-label="Ideas for your next plan">
        <p>Whatever brings you together.</p>
        <div>
          {[
            { Icon: Utensils, label: "Dinner & drinks" },
            { Icon: BedDouble, label: "Weekend stays" },
            { Icon: Building2, label: "Spaces to gather" },
            { Icon: Trophy, label: "Play & move" },
            { Icon: Palette, label: "Try something new" },
          ].map(({ Icon, label }) => (
            <span key={label}>
              <Icon size={21} strokeWidth={1.6} />
              {label}
            </span>
          ))}
        </div>
      </section>
      <section
        id="how-it-works"
        className="human-how"
        aria-labelledby="how-it-works-title"
      >
        <div className="human-section-heading">
          <div>
            <p className="eyebrow">FROM “WE SHOULD” TO “LET'S GO”</p>
            <h2 id="how-it-works-title">
              Plan together. Let your agent handle payment.
            </h2>
          </div>
          <p>
            You set the terms.
            <br />
            Your agent follows them.
          </p>
        </div>
        <div className="human-how-grid">
          {[
            {
              Icon: Users,
              title: "Bring your people",
              description:
                "Pick the kind of outing, choose a few places to consider, and share an invite with your group.",
            },
            {
              Icon: MessageSquareText,
              title: "Tell us what matters",
              description:
                "Share your budget, needs and nice-to-haves in your own words. Review what AI understood. Your original preferences stay private.",
            },
            {
              Icon: ShieldCheck,
              title: "You approve. Your agent pays.",
              description:
                "Choose a plan and review the place, amount and your share. Once everyone approves and contributes, your agent executes the payment within those agreed terms.",
            },
          ].map(({ Icon, title, description }, i) => (
            <article key={title}>
              <div className="human-step-icon">
                <Icon size={24} strokeWidth={1.6} />
                <span>0{i + 1}</span>
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
        <p className="human-signin">
          Prototype payments use test tokens. Reservations are simulated.
        </p>
      </section>
      <aside
        className="calendar-feature"
        aria-labelledby="calendar-feature-title"
      >
        <CalendarDays size={26} aria-hidden="true" />
        <div>
          <h3 id="calendar-feature-title">A shared plan. On your calendar.</h3>
          <p>
            Google Calendar integration supports automatic event creation once
            connected and your group's payment is confirmed. For now, copy your
            plan details into your calendar — no connection needed.
          </p>
          <span>
            Account connection coming later · Copy & paste available now
          </span>
        </div>
      </aside>
      <section className="human-final">
        <img
          className="human-final-photo"
          src="/images/converge-together.webp"
          width={1536}
          height={1024}
          alt="Friends planning a day together"
          loading="lazy"
        />
        <div>
          <p className="eyebrow">YOUR NEXT GOOD MEMORY</p>
          <h2>It starts with a plan.</h2>
        </div>
        <button
          className="primary"
          onClick={onConnect}
          disabled={busy || loading}
        >
          Start together <ArrowRight size={18} />
        </button>
      </section>
      <footer className="human-footer">
        <Brand />
        <Link href="/evidence">
          Behind the demo <ArrowUpRight size={16} />
        </Link>
      </footer>
    </div>
  );
}
