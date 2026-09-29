import { Pool } from "pg";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { verifiedPostgresUrl } from "../db/connection.js";
import {
  PreferenceRepository,
  PreferenceRepositoryError,
} from "../db/preferences.js";
import { WalletAuthError, WalletAuthRepository } from "../db/wallet-auth.js";
import { PreferenceError } from "../preferences.js";
import { GroupPolicyError } from "../group-policy.js";
import {
  diagnoseErrorCode,
  publicDiagnostics,
  sortDiagnostics,
  summarizeDiagnostics,
  type Diagnostic,
} from "../diagnostics/index.js";
import type { KilnAttempt } from "../kiln/client.js";

const SESSION_COOKIE = "converge_session";
const databaseUrl = process.env.DATABASE_URL;
const origin =
  process.env.APP_ORIGIN ||
  (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "");

let pool: Pool | undefined;
export function services() {
  if (!databaseUrl || !origin)
    throw new Error("DATABASE_URL and APP_ORIGIN are required");
  pool ??= new Pool({
    connectionString: verifiedPostgresUrl(databaseUrl),
    max: 5,
    connectionTimeoutMillis: 15000,
  });
  return {
    auth: new WalletAuthRepository(pool, origin),
    preferences: new PreferenceRepository(pool),
  };
}

export async function recordKilnAttempt(
  groupId: string,
  actor: string,
  revisionId: string,
  attempt: KilnAttempt,
) {
  services();
  await pool!.query(
    `INSERT INTO converge_kiln_attempts
    (request_id, attempt, group_id, wallet_address, revision_id, usage,
      http_status, error_code, cost_usd, cached_input_tokens, reasoning_tokens)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
    [
      attempt.usage.requestId,
      attempt.usage.attempt,
      groupId,
      actor.toLowerCase(),
      revisionId,
      JSON.stringify(attempt.usage),
      attempt.httpStatus,
      attempt.errorCode,
      attempt.costUsd,
      attempt.cachedInputTokens,
      attempt.reasoningTokens,
    ],
  );
}

export function verifyOrigin(request: NextRequest) {
  if (!origin || request.headers.get("origin") !== new URL(origin).origin)
    throw new ApiError(403, "INVALID_ORIGIN");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/json"))
    throw new ApiError(415, "JSON_REQUIRED");
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export async function sessionWallet(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw new ApiError(401, "AUTH_REQUIRED");
  try {
    return await services().auth.sessionWallet(token);
  } catch (error) {
    if (error instanceof WalletAuthError)
      throw new ApiError(401, "AUTH_REQUIRED");
    throw error;
  }
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(origin).protocol === "https:",
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: new URL(origin).protocol === "https:",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

// Every error response carries a `diagnostics` array so the client can render a
// reminder instead of a bare code. The shareable projection is used because an
// API response is group-visible; internal attribution stays in the server log.
function failure(status: number, code: string, source?: string) {
  const resolved = diagnoseErrorCode(source ?? code) ?? diagnoseErrorCode(code);
  const list: Diagnostic[] = resolved ? [resolved] : [];
  return NextResponse.json(
    {
      error: code,
      diagnostics: publicDiagnostics(list),
      summary: summarizeDiagnostics(list),
    },
    { status },
  );
}

export async function api(
  work: () => Promise<NextResponse>,
  options: { diagnostics?: Diagnostic[] } = {},
) {
  try {
    const result = await work();
    result.headers.set("Cache-Control", "no-store");
    return result;
  } catch (error) {
    if (error instanceof ApiError) return failure(error.status, error.code);
    if (error instanceof ZodError || error instanceof SyntaxError)
      return failure(400, "INVALID_INPUT");
    if (error instanceof WalletAuthError) {
      const status = [
        "INVALID_SIGNATURE",
        "INVALID_CHALLENGE",
        "INVALID_INVITE",
      ].includes(error.code)
        ? 400
        : error.code === "NOT_CREATOR"
          ? 403
          : 409;
      return failure(status, error.code);
    }
    if (error instanceof PreferenceRepositoryError)
      return failure(409, error.code);
    if (error instanceof PreferenceError) return failure(409, error.code);
    if (error instanceof GroupPolicyError) return failure(409, error.code);
    console.error("API request failed", error);
    if (options.diagnostics?.length)
      console.error(
        "Attached diagnostics",
        sortDiagnostics(options.diagnostics),
      );
    return failure(500, "INTERNAL_ERROR");
  }
}

// Success responses can carry the same reminder channel, which lets a
// successful-but-qualified outcome (a proposal decided by tie-break, a funding
// state still short of activation) reach the UI without a second request.
export function withDiagnostics(
  body: Record<string, unknown>,
  list: Diagnostic[],
) {
  const sorted = sortDiagnostics(list);
  return NextResponse.json({
    ...body,
    diagnostics: publicDiagnostics(sorted),
    summary: summarizeDiagnostics(sorted),
  });
}
