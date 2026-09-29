"use client";

import { useState } from "react";
import { BrandMark } from "./brand-mark";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  LockKeyhole,
  MapPin,
  Users,
  Sparkles,
} from "lucide-react";

const steps = ["Your wishes", "A good fit", "Your share", "Together"];
const examples = {
  dinner: {
    label: "Dinner",
    title: "Friday with friends",
    place: "The Garden Table",
    kind: "A quiet dinner spot",
    unit: "person / meal",
    price: 28,
    deposit: 40,
    request: "Somewhere quiet, with vegetarian options. Around $30 each.",
    tags: ["Within your budget", "Vegetarian options", "Quiet atmosphere"],
  },
  stay: {
    label: "A weekend away",
    title: "A little weekend escape",
    place: "Pine & Porch",
    kind: "A cabin for a slow weekend",
    unit: "person / night",
    price: 48,
    deposit: 80,
    request: "A cabin for four, with parking. Under $60 per person, per night.",
    tags: ["Room for four", "Parking available", "Within your budget"],
  },
  class: {
    label: "Try something new",
    title: "Make something together",
    place: "Clay & Company",
    kind: "An afternoon of pottery",
    unit: "person / session",
    price: 35,
    deposit: 60,
    request: "Let's try a beginner pottery class. Up to $40 each.",
    tags: ["Beginner friendly", "Equipment included", "Within your budget"],
  },
};

export function PlanPreview() {
  const [occasion, setOccasion] = useState<keyof typeof examples>("dinner");
  const [step, setStep] = useState(0);
  const example = examples[occasion];
  return (
    <section className="plan-preview" aria-labelledby="preview-title">
      <div className="preview-top">
        <span className="preview-brand">
          <BrandMark className="preview-mark" /> A little look inside
        </span>
        <span className="preview-example">Interactive example</span>
      </div>
      <div
        className="preview-occasions"
        role="group"
        aria-label="Example outing"
      >
        {Object.entries(examples).map(([key, item]) => (
          <button
            key={key}
            aria-pressed={occasion === key}
            onClick={() => {
              setOccasion(key as keyof typeof examples);
              setStep(0);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="preview-heading">
        <div>
          <p className="eyebrow">YOUR SHARED PLAN</p>
          <h2 id="preview-title">{example.title}</h2>
        </div>
        <span className="preview-people">
          <Users size={16} />4 friends
        </span>
      </div>
      <div
        className="preview-steps"
        role="group"
        aria-label="Explore the planning steps"
      >
        {steps.map((label, index) => (
          <button
            key={label}
            aria-pressed={step === index}
            onClick={() => setStep(index)}
          >
            <span>{index + 1}</span>
            {label}
          </button>
        ))}
      </div>
      <div className="preview-stage" aria-live="polite" aria-atomic="true">
        {step === 0 && (
          <>
            <div className="preview-state">
              <LockKeyhole size={14} />
              Only your preferences are shown
            </div>
            <h3>What's your idea of a good time?</h3>
            <div className="preview-message">
              <span>You · example preference</span>
              <p>“{example.request}”</p>
            </div>
            <div className="preview-understood">
              <Sparkles size={18} />
              <p>Review what AI understood before sharing your confirmation.</p>
            </div>
            <p className="preview-caption">
              Your friends share their own preferences privately.
            </p>
          </>
        )}
        {step === 1 && (
          <>
            <div className="preview-state">
              <Sparkles size={14} />
              An illustrative recommendation
            </div>
            <h3>A place to come together.</h3>
            <article className="preview-place">
              <div
                className={`preview-place-art ${occasion}`}
                aria-hidden="true"
              >
                <MapPin size={32} />
              </div>
              <div>
                <span>{example.kind}</span>
                <strong>{example.place}</strong>
                <p>
                  ${example.price} <small>/ {example.unit}</small>
                </p>
              </div>
            </article>
            <div className="preview-reasons">
              {example.tags.map((tag) => (
                <span key={tag}>
                  <Check size={14} />
                  {tag}
                </span>
              ))}
            </div>
            <p className="preview-caption">
              In a real plan, suggestions use everyone's confirmed requirements.
            </p>
          </>
        )}
        {step === 2 && (
          <>
            <div className="preview-state">No surprises before you approve</div>
            <h3>Here's what you'd contribute.</h3>
            <div className="preview-amount">
              <span>Your share of the deposit</span>
              <strong>
                {example.deposit / 4} <small>USDC</small>
              </strong>
              <span>Test tokens · not real money</span>
            </div>
            <dl className="preview-split">
              <div>
                <dt>Group deposit</dt>
                <dd>{example.deposit} USDC</dd>
              </div>
              <div>
                <dt>Split equally</dt>
                <dd>4 friends</dd>
              </div>
            </dl>
            <p className="preview-caption">
              This is the deposit, not the full outing cost. You review all
              payment terms before signing.
            </p>
          </>
        )}
        {step === 3 && (
          <>
            <div className="preview-state">
              <Users size={14} />
              Everyone gets a say
            </div>
            <h3>You approve. Your agent pays.</h3>
            <div className="preview-approval">
              <span>
                <Check size={16} />
                Review the same place and costs
              </span>
              <span>
                <Check size={16} />
                Everyone approves and contributes their share
              </span>
              <span>
                <LockKeyhole size={16} />
                Your agent pays within the approved terms
              </span>
            </div>
            <p className="preview-caption">
              No approvals or payments happen in this preview. In the prototype,
              bookings are simulated.
            </p>
          </>
        )}
      </div>
      <div className="preview-controls">
        <button
          aria-label="Previous preview step"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          <ArrowLeft size={17} />
        </button>
        <span>{step + 1} of 4</span>
        <button
          className="preview-next"
          onClick={() => setStep(step === 3 ? 0 : step + 1)}
        >
          {step === 3 ? "Try it again" : steps[step + 1]}
          <ArrowRight size={16} />
        </button>
      </div>
      <p className="preview-disclaimer">
        Sample names & amounts · Nothing is booked or saved
      </p>
    </section>
  );
}
