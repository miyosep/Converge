import { formatUnits, parseUnits } from "viem";
import { z } from "zod";
import type { LivePreference } from "./group-preferences";

export type DepositEstimate = {
  percent: 30;
  source: "restaurant_price" | "confirmed_budget";
  currency: string;
  basisAmount: string;
  unit: "per_person" | "group";
  rangeUpperBound: boolean;
  usdRate: string;
  rateDate: string | null;
  amount: string;
};
const currencies = /USD|KRW|EUR|GBP|JPY|US\$|\$|₩|€|£|¥/gi;
const currencyAliases: Record<string, string> = {
  $: "USD",
  US$: "USD",
  "₩": "KRW",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
};
const currencyCode = (value: string) =>
  currencyAliases[value.toUpperCase()] ?? value.toUpperCase();
export function parsePriceBasis(text: string) {
  const codes = [...new Set((text.match(currencies) ?? []).map(currencyCode))];
  if (
    codes.length !== 1 ||
    /(?:\d)\s*[kKmM]\b|per night|per hour|monthly|annually/i.test(text)
  )
    return null;
  const values =
    text
      .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "")
      .match(/\d+(?:\.\d{1,6})?/g) ?? [];
  // More numbers may be party size, dates or unrelated figures: do not guess.
  if (!values.length || values.length > 2) return null;
  if (/(?:^|USD|KRW|EUR|GBP|JPY|[$₩€£¥])\s*-\s*\d/i.test(text)) return null;
  if (
    values.length === 2 &&
    !/\d[\d,.]*\s*(?:[-–—~]|to)\s*(?:(?:USD|KRW|EUR|GBP|JPY|[$₩€£¥])\s*)?\d/i.test(
      text,
    )
  )
    return null;
  const numbers = values.map((value) => parseUnits(value, 6));
  if (numbers.some((value) => value <= 0n || value > 1_000_000_000_000_000n))
    return null;
  return {
    currency: codes[0]!,
    amount: formatUnits(
      numbers.reduce((a, b) => (a > b ? a : b)),
      6,
    ),
    unit: /\b(total|group|altogether)\b/i.test(text)
      ? ("group" as const)
      : ("per_person" as const),
    rangeUpperBound: values.length === 2,
  };
}

export async function estimateGroupDeposit(input: {
  price: string | null | undefined;
  preferences: NonNullable<LivePreference["extraction"]>[];
  people: number;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<DepositEstimate> {
  z.number().int().min(2).max(100).parse(input.people);
  const restaurant = input.price ? parsePriceBasis(input.price) : null;
  const budgets = input.preferences
    .flatMap((p) => p.requirements)
    .filter((r) =>
      /budget|under|up to|at most|\bmax|less than|per person|each|total/i.test(
        r.text,
      ),
    )
    .map((r) => parsePriceBasis(r.text))
    .filter((v) => v !== null);
  const sources = restaurant ? [restaurant] : budgets;
  if (!sources.length) throw new Error("PAYMENT_BASIS_MISSING");
  const rates = new Map<string, { rate: string; date: string | null }>();
  async function exchange(currency: string) {
    if (currency === "USD") return { rate: "1", date: null };
    if (rates.has(currency)) return rates.get(currency)!;
    try {
      const response = await (input.fetchImpl ?? fetch)(
        `https://api.frankfurter.dev/v2/rate/${currency}/USD`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!response.ok) throw new Error();
      const data = z
        .object({
          base: z.literal(currency),
          quote: z.literal("USD"),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          rate: z.number().positive().max(1_000_000),
        })
        .parse(await response.json());
      const age =
        (input.now ?? Date.now()) - Date.parse(data.date + "T00:00:00Z");
      if (!Number.isFinite(age) || age < -86_400_000 || age > 7 * 86_400_000)
        throw new Error();
      const value = { rate: data.rate.toFixed(12), date: data.date };
      rates.set(currency, value);
      return value;
    } catch {
      throw new Error("PAYMENT_RATE_UNAVAILABLE");
    }
  }
  const estimates = [];
  for (const basis of sources) {
    const fx = await exchange(basis.currency);
    const total =
      parseUnits(basis.amount, 6) *
      (basis.unit === "per_person" ? BigInt(input.people) : 1n);
    // Round the group's 30% deposit up once to a token base unit; never use floats for money.
    const numerator = total * parseUnits(fx.rate, 12) * 30n;
    const denominator = 100n * 10n ** 12n;
    const amount = (numerator + denominator - 1n) / denominator;
    if (amount <= 0n) throw new Error("PAYMENT_BASIS_MISSING");
    estimates.push({ basis, fx, amount });
  }
  // Without a restaurant price use the lowest confirmed group-equivalent budget.
  const chosen = estimates.reduce((a, b) => (a.amount <= b.amount ? a : b));
  return {
    percent: 30,
    source: restaurant ? "restaurant_price" : "confirmed_budget",
    currency: chosen.basis.currency,
    basisAmount: chosen.basis.amount,
    unit: chosen.basis.unit,
    rangeUpperBound: chosen.basis.rangeUpperBound,
    usdRate: chosen.fx.rate,
    rateDate: chosen.fx.date,
    amount: formatUnits(chosen.amount, 6),
  };
}
