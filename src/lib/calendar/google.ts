import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import type { GroupOverview } from "../group-view.js";
import { unanimousPlace } from "../discovery/live-plan.js";

export const CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.owned";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function calendarConfig() {
  const {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_TOKEN_ENCRYPTION_KEY: key,
    APP_ORIGIN: origin,
  } = process.env;
  if (
    !clientId ||
    !clientSecret ||
    !key ||
    !/^[a-f0-9]{64}$/i.test(key) ||
    !origin
  )
    throw new Error("CALENDAR_NOT_CONFIGURED");
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error("CALENDAR_NOT_CONFIGURED");
  return {
    clientId,
    clientSecret,
    key: Buffer.from(key, "hex"),
    origin,
    redirectUri: origin + "/api/calendar/callback",
  };
}
export function calendarConfigured() {
  try {
    calendarConfig();
    return true;
  } catch {
    return false;
  }
}
export function seal(
  value: string,
  context: string,
  key = calendarConfig().key,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  return Buffer.concat([
    iv,
    cipher.update(value, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64url");
}
export function unseal(
  value: string,
  context: string,
  key = calendarConfig().key,
) {
  const b = Buffer.from(value, "base64url");
  if (b.length < 29) throw new Error("INVALID_ENCRYPTED_TOKEN");
  const decipher = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(b.subarray(-16));
  return Buffer.concat([
    decipher.update(b.subarray(12, -16)),
    decipher.final(),
  ]).toString("utf8");
}
export function authorizationUrl(state: string, verifier: string) {
  const config = calendarConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: `openid email ${CALENDAR_SCOPE}`,
    access_type: "offline",
    prompt: "consent select_account",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}
export class GoogleCalendarError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
async function tokenRequest(body: Record<string, string>) {
  const c = calendarConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      ...body,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new GoogleCalendarError(
      response.status === 400
        ? "RECONNECT_GOOGLE"
        : "GOOGLE_TEMPORARILY_UNAVAILABLE",
    );
  return z
    .object({
      access_token: z.string().min(1),
      refresh_token: z.string().optional(),
      scope: z.string().optional(),
    })
    .parse(await response.json());
}
export async function exchangeCode(code: string, verifier: string) {
  const tokens = await tokenRequest({
    code,
    code_verifier: verifier,
    redirect_uri: calendarConfig().redirectUri,
    grant_type: "authorization_code",
  });
  if (
    !tokens.refresh_token ||
    !tokens.scope?.split(" ").includes(CALENDAR_SCOPE)
  )
    throw new GoogleCalendarError("CALENDAR_PERMISSION_REQUIRED");
  const response = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new GoogleCalendarError("GOOGLE_IDENTITY_UNAVAILABLE");
  const user = z
    .object({
      sub: z.string().min(1),
      email: z.string().email(),
      email_verified: z.literal(true),
    })
    .parse(await response.json());
  return {
    subject: user.sub,
    email: user.email,
    refreshToken: tokens.refresh_token,
  };
}
export function eventId(group: string, wallet: string, subject: string) {
  return digest(JSON.stringify([group, wallet.toLowerCase(), subject]));
}
export function calendarEvent(
  overview: GroupOverview,
  durationMinutes: number,
  id: string,
) {
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 15 ||
    durationMinutes > 10080
  )
    throw new Error("INVALID_DURATION");
  const live =
    overview.livePlan &&
    unanimousPlace(
      overview.livePlan,
      overview.participants.map((member) => member.walletAddress),
      overview.group.targetMemberCount,
    );
  const selected =
    live ||
    overview.evaluation?.catalog.find(
      (v) => v.id === overview.evaluation?.winnerId,
    );
  if (!selected || !overview.signingPolicy) throw new Error("PLAN_NOT_READY");
  const start = new Date(overview.group.startsAt),
    end = new Date(start.getTime() + durationMinutes * 60000);
  return {
    id,
    summary: `[Converge prototype] ${overview.group.name}`,
    location: live
      ? `${live.name} — ${live.address}`
      : `${selected.name} — sample venue`,
    description:
      "Shared plan from Converge. Test payment recorded; this is NOT a real venue reservation. Duration was chosen by you. No private preferences or other participants' details are included.",
    start: { dateTime: start.toISOString(), timeZone: overview.group.timeZone },
    end: { dateTime: end.toISOString(), timeZone: overview.group.timeZone },
    status: "tentative",
    visibility: "private",
    transparency: "transparent",
    reminders: { useDefault: false },
    extendedProperties: { private: { convergeEvent: id } },
  };
}
export async function insertCalendarEvent(
  refreshToken: string,
  event: ReturnType<typeof calendarEvent>,
) {
  const tokens = await tokenRequest({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    "Content-Type": "application/json",
  };
  let response = await fetch(url + "?sendUpdates=none", {
    method: "POST",
    headers,
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 409)
    response = await fetch(url + "/" + event.id, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
  if (!response.ok)
    throw new GoogleCalendarError(
      [401, 403].includes(response.status)
        ? "RECONNECT_GOOGLE"
        : response.status === 410
          ? "EVENT_REMOVED"
          : "GOOGLE_TEMPORARILY_UNAVAILABLE",
    );
  const data = await response.json();
  if (
    data.id !== event.id ||
    data.extendedProperties?.private?.convergeEvent !== event.id ||
    data.status === "cancelled"
  )
    throw new GoogleCalendarError("EVENT_CONFLICT");
  const link = new URL(data.htmlLink);
  if (
    link.protocol !== "https:" ||
    !["www.google.com", "calendar.google.com"].includes(link.hostname)
  )
    throw new GoogleCalendarError("INVALID_EVENT_LINK");
  return link.toString();
}
