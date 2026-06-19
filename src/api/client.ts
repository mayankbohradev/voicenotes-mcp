/**
 * VoicenotesApiClient — the single chokepoint for every REST call to
 * api.voicenotes.com. It owns: attaching the Bearer token, JSON encoding,
 * and turning HTTP failures into structured, LLM-friendly errors.
 *
 * Design note: the client does NOT know HOW the token was obtained (OAuth vs.
 * paste). It receives a `getToken()` provider and, for 401 recovery, an
 * `onUnauthorized()` hook. This keeps the auth layer and the data layer
 * decoupled and independently testable.
 */

import { API_BASE_URL } from "../config.js";

/**
 * Structured error thrown by the client. Tool handlers catch this and convert
 * it into an MCP tool-result error (isError: true) rather than letting it
 * bubble as a protocol fault — see tools/*.ts.
 */
export class VoicenotesApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 for network/transport failures. */
    public readonly status: number,
    /** Parsed error body from the API, if any. */
    public readonly body?: unknown,
    /** Actionable next step for the model/user. */
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = "VoicenotesApiError";
  }
}

export interface VoicenotesApiClientOptions {
  /** Returns a valid Bearer access token (may refresh under the hood). */
  getToken: () => Promise<string>;
  /**
   * Invoked when the API returns 401. Should attempt recovery (refresh) and
   * return a fresh token to retry with, or throw / return null to give up.
   * The token-expiry policy is implemented by onUnauthorized() in auth/oauth.ts.
   */
  onUnauthorized?: () => Promise<string | null>;
}

export class VoicenotesApiClient {
  private readonly baseUrl = API_BASE_URL;

  constructor(private readonly opts: VoicenotesApiClientOptions) {}

  /**
   * Core request method. Generic over the expected response shape.
   * Performs ONE automatic retry after a successful re-auth on 401.
   */
  async request<T>(
    path: string,
    init: RequestInit = {},
    _isRetry = false,
  ): Promise<T> {
    const token = await this.opts.getToken();

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...init.headers,
        },
      });
    } catch (err) {
      // Network / DNS / TLS failure — transport level, status 0.
      throw new VoicenotesApiError(
        `Network error reaching Voicenotes: ${(err as Error).message}`,
        0,
        undefined,
        "Check your internet connection and that api.voicenotes.com is reachable.",
      );
    }

    if (response.status === 401) {
      // Delegate the recovery POLICY to the auth layer's onUnauthorized hook.
      if (!_isRetry && this.opts.onUnauthorized) {
        const fresh = await this.opts.onUnauthorized();
        if (fresh) {
          return this.request<T>(path, init, true);
        }
      }
      throw new VoicenotesApiError(
        "Voicenotes rejected the access token (401 Unauthorized).",
        401,
        await safeJson(response),
        "Re-authenticate: run the OAuth flow again (the cached token is invalid or expired).",
      );
    }

    if (!response.ok) {
      const body = await safeJson(response);
      throw new VoicenotesApiError(
        `Voicenotes API error ${response.status} on ${init.method ?? "GET"} ${path}.`,
        response.status,
        body,
        suggestForStatus(response.status),
      );
    }

    // 204 No Content (e.g. DELETE) — nothing to parse.
    if (response.status === 204) return undefined as T;

    return (await safeJson(response)) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body: JSON.stringify(body) });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }
}

/** Parse a response body as JSON, tolerating empty/non-JSON bodies. */
async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/** Map common HTTP statuses to an actionable suggestion for the model. */
function suggestForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Check the request parameters — a field is malformed or missing.";
    case 403:
      return "The token lacks permission for this action (scope is 'mcp:use').";
    case 404:
      return "The note or tag id does not exist (or was deleted). List items first to get a valid id.";
    case 410:
      return "This resource was deleted and is gone permanently.";
    case 422:
      return "Validation failed — check value formats (e.g. ISO dates, tag names).";
    case 429:
      return "Rate limited by Voicenotes. Wait a moment and retry.";
    default:
      return status >= 500
        ? "Voicenotes server error — retry shortly."
        : "Inspect the error body for details.";
  }
}
