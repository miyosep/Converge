import { getAddress, isAddress, zeroAddress } from "viem";
import { z } from "zod";

const UINT256_MAX = (1n << 256n) - 1n;

// JSON token amounts are canonical base-unit strings, never JS numbers.
export const tokenAmountSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,77})$/)
  .refine(
    (value) =>
      /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) <= UINT256_MAX,
    "Amount exceeds uint256",
  );
export const centsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const unixSecondsSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
export const utcTimestampSchema = z.iso.datetime({ precision: 0 });
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid time zone");
export const addressSchema = z
  .string()
  .refine(
    (value) =>
      isAddress(value, { strict: true }) && value.toLowerCase() !== zeroAddress,
    "Expected a nonzero EVM address with valid casing",
  )
  .transform((value) => getAddress(value));
export const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const idSchema = z.string().min(1).max(128);
