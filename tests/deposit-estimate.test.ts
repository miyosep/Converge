import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateGroupDeposit,
  parsePriceBasis,
} from "../src/lib/discovery/deposit-estimate";
const budget = (text: string) => ({
  requirements: [{ text, importance: "preferred" as const }],
  clarifications: [],
});
test("30 percent uses price first, falls back to lowest confirmed budget and preserves group units", async () => {
  assert.equal(
    (
      await estimateGroupDeposit({
        price: "$30 per person",
        preferences: [budget("under $20")],
        people: 2,
      })
    ).amount,
    "18",
  );
  const fallback = await estimateGroupDeposit({
    price: "$$",
    preferences: [budget("under $30"), budget("under $40")],
    people: 2,
  });
  assert.equal(fallback.amount, "18");
  assert.equal(fallback.source, "confirmed_budget");
  assert.equal(
    (
      await estimateGroupDeposit({
        price: null,
        preferences: [budget("total group budget USD 100")],
        people: 4,
      })
    ).amount,
    "30",
  );
  await assert.rejects(
    estimateGroupDeposit({
      price: "$$",
      preferences: [budget("Japanese cuisine")],
      people: 2,
    }),
    /PAYMENT_BASIS_MISSING/,
  );
  assert.equal(parsePriceBasis("30"), null);
  assert.equal(parsePriceBasis("up to $30 for 6 people"), null);
  assert.equal(parsePriceBasis("$-30"), null);
  assert.equal(parsePriceBasis("USD 30 or KRW 40000"), null);
  assert.equal(parsePriceBasis("JPY 30k"), null);
});
test("KRW price range is an explicit upper-bound estimate with a dated USD rate, never a fixed 10", async () => {
  const result = await estimateGroupDeposit({
    price: "₩10,000–20,000",
    preferences: [],
    people: 2,
    now: Date.parse("2026-09-30T12:00:00Z"),
    fetchImpl: async (url) => {
      assert.equal(url, "https://api.frankfurter.dev/v2/rate/KRW/USD");
      return Response.json({
        base: "KRW",
        quote: "USD",
        date: "2026-09-29",
        rate: 0.00074,
      });
    },
  });
  assert.equal(result.amount, "8.88");
  assert.equal(result.basisAmount, "20000");
  assert.equal(result.rangeUpperBound, true);
  assert.equal(result.rateDate, "2026-09-29");
  await assert.rejects(
    estimateGroupDeposit({
      price: "KRW 20000",
      preferences: [],
      people: 2,
      fetchImpl: async () =>
        Response.json({
          base: "KRW",
          quote: "USD",
          date: "2020-01-01",
          rate: 0.00074,
        }),
    }),
    /PAYMENT_RATE_UNAVAILABLE/,
  );
  await assert.rejects(
    estimateGroupDeposit({
      price: "KRW 20000",
      preferences: [],
      people: 2,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }),
    /PAYMENT_RATE_UNAVAILABLE/,
  );
});
