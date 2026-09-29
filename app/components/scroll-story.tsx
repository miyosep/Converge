"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  LockKeyhole,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { BrandMark } from "./brand-mark";

const chapters = [
  {
    label: "Share privately",
    title: "Your wishes.\nJust between us.",
    text: "Tell us what matters. Your friends never see your individual answers.",
  },
  {
    label: "Find a fit",
    title: "Different wishes.\nOne good fit.",
    text: "AI helps understand your wishes. Confirm them to find options that fit the group.",
  },
  {
    label: "Approve together",
    title: "Everyone agrees.\nEveryone has a say.",
    text: "Review the place, payment and your share. Each person approves and contributes.",
  },
  {
    label: "Let your agent pay",
    title: "You approve.\nYour agent pays.",
    text: "Once everyone is ready, your agent pays within the agreed terms.",
  },
];

export function ScrollStory() {
  const root = useRef<HTMLElement>(null);
  const [enhanced, setEnhanced] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const query = window.matchMedia(
      "(min-width: 900px) and (min-height: 650px) and (prefers-reduced-motion: no-preference)",
    );
    const mode = () => setEnhanced(query.matches);
    mode();
    query.addEventListener("change", mode);
    return () => query.removeEventListener("change", mode);
  }, []);
  useEffect(() => {
    if (!enhanced) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const travel = rect.height - window.innerHeight;
      const progress = Math.max(
        0,
        Math.min(1, -rect.top / Math.max(1, travel)),
      );
      setActive(Math.min(3, Math.floor(progress * 4)));
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", scroll);
    return () => {
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", scroll);
      cancelAnimationFrame(frame);
    };
  }, [enhanced]);
  const jump = (index: number) => {
    const node = root.current;
    if (!node) return;
    const top = node.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({
      top: top + (node.offsetHeight - window.innerHeight) * ((index + 0.1) / 4),
      behavior: "auto",
    });
  };
  return (
    <section
      id="how-it-works"
      className="scroll-story"
      ref={root}
      data-enhanced={enhanced}
      aria-label="From private wishes to an approved payment"
    >
      <div className="story-sticky">
        <div className="story-topline">
          <span>A PLAN COMES TOGETHER</span>
          <span>Illustrative example · No booking or payment</span>
        </div>
        {enhanced && (
          <nav
            className="story-progress"
            aria-label="Explore the planning stages"
          >
            {chapters.map((chapter, i) => (
              <button
                key={chapter.label}
                aria-label={`${i + 1}. ${chapter.label}`}
                aria-current={active === i ? "step" : undefined}
                onClick={() => jump(i)}
              >
                <span>0{i + 1}</span>
                {chapter.label}
              </button>
            ))}
          </nav>
        )}
        <div className="story-scenes">
          {chapters.map((chapter, i) => (
            <article
              className="story-scene"
              key={chapter.label}
              data-active={active === i}
              aria-hidden={enhanced && active !== i ? true : undefined}
            >
              <div className="story-copy">
                <span className="story-step">
                  0{i + 1} / {chapter.label}
                </span>
                <h2>
                  {chapter.title.split("\n").map((line, j) => (
                    <span
                      key={line}
                      className={j === 1 ? "story-accent" : undefined}
                    >
                      {line}
                    </span>
                  ))}
                </h2>
                <p>{chapter.text}</p>
              </div>
              <div className="story-visual">
                <div className="story-card-top">
                  <BrandMark className="story-logo" />
                  <span>Friday with friends</span>
                  <span className="story-sample">EXAMPLE</span>
                </div>
                {i === 0 && (
                  <div className="story-private">
                    <div className="story-status">
                      <LockKeyhole size={16} /> Only visible to you
                    </div>
                    <div className="story-message">
                      “Somewhere quiet, with vegetarian options. Around $30
                      each.”
                    </div>
                    <div className="story-tags">
                      <span>Quiet spot</span>
                      <span>Vegetarian</span>
                      <span>Under $30</span>
                    </div>
                    <div className="story-locked">
                      {["Alex", "Sam", "Jamie"].map((name) => (
                        <div key={name}>
                          <span className="story-avatar">{name[0]}</span>
                          <span>{name}'s preferences</span>
                          <LockKeyhole size={16} aria-label="Private" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {i === 1 && (
                  <div className="story-match">
                    <img
                      src="/images/converge-together.webp"
                      alt="Friends gathered around an outdoor dining table"
                      width={1536}
                      height={1024}
                      loading="lazy"
                    />
                    <div className="story-match-copy">
                      <div className="story-status">
                        <Sparkles size={16} /> A fit for your group
                      </div>
                      <h3>The Garden Table</h3>
                      <p>Good food. Room for conversation.</p>
                      <div className="story-tags">
                        <span>
                          <Check size={14} /> Budget
                        </span>
                        <span>
                          <Check size={14} /> Food needs
                        </span>
                        <span>
                          <Check size={14} /> Atmosphere
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {i === 2 && (
                  <div className="story-approval">
                    <div className="story-total">
                      <span>Your share of the deposit</span>
                      <strong>
                        10 <small>USDC</small>
                      </strong>
                      <span>40 USDC total · 4 friends</span>
                    </div>
                    <div className="story-locked">
                      {["You", "Alex", "Sam", "Jamie"].map((name) => (
                        <div key={name}>
                          <span className="story-avatar">{name[0]}</span>
                          <strong>{name}</strong>
                          <span className="story-approved">
                            <Check size={15} /> Approved & funded
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {i === 3 && (
                  <div className="story-payment">
                    <div className="story-payment-icon">
                      <ShieldCheck size={38} />
                    </div>
                    <span className="story-status">All four approved</span>
                    <h3>Your agent takes it from here.</h3>
                    <div className="story-transfer">
                      <span>Group funds</span>
                      <ArrowRight size={24} />
                      <span>The Garden Table</span>
                    </div>
                    <strong className="story-paid">
                      40 <small>USDC</small>
                    </strong>
                    <div className="story-status">
                      <Check size={16} /> Within your approved terms
                    </div>
                    <p>Example payment flow</p>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
        {enhanced && (
          <p className="story-scroll-hint">
            {active === 3
              ? "Less to organise. More to look forward to."
              : "Keep scrolling to see the next step ↓"}
          </p>
        )}
      </div>
    </section>
  );
}
