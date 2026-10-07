/**
 * Error classification and user-facing copy (P0 Baseline §11.1, §13.3).
 *
 * The contract declares exactly one error body and exactly eight `ErrorCode` values, so
 * this file keys off those codes rather than off strings it made up. Two of the eight
 * share one presentation: `TICKET_VERSION_CONFLICT` and `CONFLICT` are both "the ticket
 * moved", which is why §13.3 describes one behaviour for 409.
 *
 *   validation → inline field errors, input preserved
 *   permission → denial, no partial data
 *   notfound   → generic "not available", no existence hints
 *   conflict   → notice + re-fetch of the authoritative ticket (§13.3)
 *   system     → banner with a retry affordance
 *
 * A request that never produced an HTTP response is not a contract error: it stays a
 * local `NETWORK_ERROR` label and must never be sent to the server as if it were one.
 */

import { ApiError } from "../api/client";
import type { ErrorCode } from "../api";

export type ErrorKind = "validation" | "permission" | "notfound" | "conflict" | "system";

/** The eight codes the contract allows, plus the one the client invents locally. */
export type ClassifiedCode = ErrorCode | "NETWORK_ERROR";

export interface ClassifiedError {
  kind: ErrorKind;
  code: ClassifiedCode;
  /** Copy safe to render to a user. */
  message: string;
  /** Per-field messages, only ever populated for VALIDATION_ERROR. */
  fields: Record<string, string>;
  requestId?: string;
}

const CONFLICT_CODES: readonly string[] = ["TICKET_VERSION_CONFLICT", "CONFLICT"];
const PERMISSION_CODES: readonly string[] = ["FORBIDDEN", "ORIGIN_NOT_ALLOWED"];

const SYSTEM_FALLBACK = "The service is temporarily unavailable. Please try again.";

function kindOf(err: ApiError): ErrorKind {
  if (err.status === 409 || CONFLICT_CODES.includes(err.code)) return "conflict";
  if (err.code === "VALIDATION_ERROR") return "validation";
  if (err.status === 401 || PERMISSION_CODES.includes(err.code)) return "permission";
  if (err.status === 404 || err.code === "NOT_FOUND") return "notfound";
  return "system";
}

export function classify(err: unknown): ClassifiedError {
  if (!(err instanceof ApiError)) {
    return {
      kind: "system",
      code: "NETWORK_ERROR",
      message: "Could not reach the service. Check your connection and retry.",
      fields: {},
    };
  }

  const kind = kindOf(err);
  return {
    kind,
    code: err.code,
    // The envelope's message is authored server-side for readers, so it is rendered as
    // given; only an empty one needs the client's fallback.
    message: err.message || SYSTEM_FALLBACK,
    fields: err.fields,
    requestId: err.requestId,
  };
}

/** Inline messages for form fields, keyed exactly as the server named them. */
export function fieldErrors(err: unknown): Record<string, string> {
  return classify(err).fields;
}

/** §13.3's 409 copy: the version case says why, the state case says what happened. */
export function conflictMessage(classified: ClassifiedError): string {
  if (classified.code === "TICKET_VERSION_CONFLICT") {
    return "This ticket was updated by someone else. Showing the current state — please retry from there.";
  }
  return "The ticket has moved on since this page was loaded. Showing the current state — please retry from there.";
}

/** Shown under an error banner so support can trace one request in the server logs. */
export function referenceLine(classified: ClassifiedError): string | null {
  return classified.requestId ? `Reference: ${classified.requestId}` : null;
}
