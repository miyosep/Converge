"use client";

import { useCallback, useEffect, useState } from "react";
import type { MockReservation } from "../../src/lib/explore/mock-reservation.js";
import "./styles.css";

const statusText: Record<MockReservation["status"], string> = {
  REQUESTED: "Request received by the demo restaurant",
  DEPOSIT_OBSERVED: "Test deposit observed; confirmation pending",
  DEMO_CONFIRMED: "Demo booking confirmed",
  CANCELLED: "Request cancelled",
  EXPIRED: "Request expired",
};

export default function KagamiRestaurant() {
  const [reservation, setReservation] = useState<MockReservation | null>(null);
  const [message, setMessage] = useState("Checking your Converge session…");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/demo/reservation", {
        cache: "no-store",
      });
      if (!response.ok) {
        setReservation(null);
        setMessage(
          response.status === 401
            ? "Open Explore Demo and connect your wallet to view your request."
            : "No reservation is available for this session.",
        );
        return;
      }
      const body = (await response.json()) as {
        reservation: MockReservation | null;
      };
      if (body.reservation?.restaurant === "KAGAMI") {
        setReservation(body.reservation);
        setMessage("");
      } else {
        setReservation(null);
        setMessage(
          body.reservation
            ? "Your Converge session selected another restaurant."
            : "No KAGAMI request has been created for this session.",
        );
      }
    } catch {
      setMessage("Could not check the demo reservation. Try again.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className="kagami">
      <a className="skip-link" href="#reserve">
        Skip to your reservation request
      </a>
      <div className="kagami-demo-bar">
        <span>A fictional dining experience by Converge</span>
        <a href="/demo">
          Back to the demo <span aria-hidden="true">↗</span>
        </a>
      </div>
      <nav className="kagami-nav" aria-label="KAGAMI navigation">
        <a className="kagami-brand" href="#top">
          <span>鏡</span> KAGAMI
        </a>
        <div>
          <a href="#menu">Menu</a>
          <a href="#visit">Visit</a>
          <a href="#reserve">Reservation</a>
        </div>
      </nav>
      <section className="kagami-hero" id="top">
        <div className="kagami-hero-copy">
          <p className="kagami-eyebrow">JAPANESE RESTAURANT · FICTIONAL DEMO</p>
          <h1>
            A quiet room.
            <br />A warm counter.
            <br />
            <em>A moment to share.</em>
          </h1>
          <p>
            KAGAMI is the fictional Restaurant A in this Converge demonstration.
            Bookings and payments shown here use test data and USDC.
          </p>
          <a className="kagami-button" href="#reserve">
            View your request <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="kagami-plate-art" aria-hidden="true">
          <div className="kagami-plate">
            <span>鏡</span>
            <small>KAGAMI</small>
          </div>
          <span className="chopstick chopstick-one" />
          <span className="chopstick chopstick-two" />
          <span className="plate-caption">
            季節を味わう
            <br />
            <small>THE ART OF SHARING A TABLE</small>
          </span>
        </div>
      </section>
      <section className="kagami-section" id="menu">
        <p className="kagami-eyebrow">お品書き · THE MENU</p>
        <h2>Seasonal Japanese dining</h2>
        <p>
          Sample dishes from the KAGAMI concept include Hokkaido scallop,
          chawanmushi, kinmedai, nigiri, and matcha warabi mochi. The chef’s
          omakase is listed at $148 per guest in the source concept. Converge’s
          $32 table meal estimate is a separate synthetic demo value, not an
          omakase quote or a live menu price.
        </p>
        <p className="kagami-note">
          Please ask the restaurant about allergies. This demo page cannot
          verify ingredient handling or cross contact safety.
        </p>
      </section>
      <section className="kagami-section kagami-visit" id="visit">
        <p className="kagami-eyebrow">ご案内 · VISIT</p>
        <h2>Visit KAGAMI</h2>
        <p>Tuesday–Thursday 17:30–22:00 · Friday–Saturday 17:00–23:00</p>
        <p>Sunday 17:00–21:00 · Monday closed</p>
        <p>Seoul demo location · address available upon confirmation</p>
        <p className="kagami-note">
          This location and schedule are fictional and use Korea Standard Time.
        </p>
      </section>
      <section className="kagami-section kagami-reserve" id="reserve">
        <p className="kagami-eyebrow">ご予約 · RESERVATION</p>
        <h2>Your Converge request</h2>
        <p>
          The Converge agent prepares a six-person demo request. The restaurant
          simulator confirms it only after matching the policy and the on-chain
          payment event. No real table is reserved.
        </p>
        <button type="button" onClick={() => void refresh()} disabled={busy}>
          {busy ? "Checking…" : "Refresh status"}
        </button>
        {reservation ? (
          <div className="kagami-receipt" role="status">
            <strong>{statusText[reservation.status]}</strong>
            <dl>
              <div>
                <dt>Guests</dt>
                <dd>{reservation.guests}</dd>
              </div>
              <div>
                <dt>Request name</dt>
                <dd>{reservation.contactName ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Demo contact</dt>
                <dd>{reservation.contactEmail ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Requested time</dt>
                <dd>
                  {new Date(reservation.startsAt).toLocaleString("en-US", {
                    timeZone: "Asia/Seoul",
                  })}{" "}
                  KST
                </dd>
              </div>
              <div>
                <dt>Policy reference</dt>
                <dd className="kagami-code">{reservation.reference}</dd>
              </div>
              {reservation.paymentHash && (
                <div>
                  <dt>Test payment</dt>
                  <dd>
                    <a
                      href={`https://sepolia.etherscan.io/tx/${reservation.paymentHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on Sepolia
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </div>
        ) : (
          <p className="kagami-note" role="status">
            {message}
          </p>
        )}
        <a className="kagami-return" href="/demo">
          Open Converge Explore Demo →
        </a>
      </section>
      <footer className="kagami-footer">
        <span>鏡 KAGAMI</span>
        <span>Fictional restaurant and reservation simulator</span>
      </footer>
    </main>
  );
}
