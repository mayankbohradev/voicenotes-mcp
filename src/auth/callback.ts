/**
 * Loopback OAuth callback server.
 *
 * Spins up a single-purpose HTTP listener on 127.0.0.1:<CALLBACK_PORT>, waits
 * for exactly one redirect to /callback, validates the `state` parameter
 * (anti-CSRF, MCP spec MUST), extracts the authorization `code`, then shuts
 * down. Binds to loopback only — never 0.0.0.0.
 */

import { createServer, type Server } from "node:http";
import { CALLBACK_PORT } from "../config.js";

export interface CallbackResult {
  code: string;
}

const SUCCESS_HTML = `<!doctype html><meta charset="utf-8">
<title>Voicenotes MCP — Connected</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center">
<h2>✅ Connected to Voicenotes</h2>
<p>Authorization complete. You can close this tab and return to your assistant.</p>
</body>`;

function errorHtml(msg: string): string {
  return `<!doctype html><meta charset="utf-8">
<title>Voicenotes MCP — Error</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center">
<h2>❌ Authorization failed</h2><p>${escapeHtml(msg)}</p>
<p>Close this tab and try again.</p></body>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * Wait for the OAuth provider to redirect back with a code.
 *
 * @param expectedState the state value we sent on the authorization request.
 * @param timeoutMs how long to wait before giving up (default 5 min).
 * @returns the authorization code once validated.
 */
export function waitForCallback(
  expectedState: string,
  timeoutMs = 5 * 60_000,
): Promise<CallbackResult> {
  return new Promise<CallbackResult>((resolve, reject) => {
    let server: Server;

    const timer = setTimeout(() => {
      server?.close();
      reject(
        new Error(
          `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the OAuth callback. Did the browser complete sign-in?`,
        ),
      );
    }, timeoutMs);

    const finish = (
      res: import("node:http").ServerResponse,
      status: number,
      html: string,
      done: () => void,
    ) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      clearTimeout(timer);
      // Close after the response flushes so the browser actually renders it.
      setImmediate(() => {
        server.close();
        done();
      });
    };

    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const desc = url.searchParams.get("error_description") ?? error;
        finish(res, 400, errorHtml(desc), () =>
          reject(new Error(`OAuth provider returned error: ${desc}`)),
        );
        return;
      }

      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");

      // Anti-CSRF: reject any state mismatch outright.
      if (!state || state !== expectedState) {
        finish(res, 400, errorHtml("State mismatch — possible CSRF. Aborted."), () =>
          reject(new Error("OAuth state mismatch — aborting for safety.")),
        );
        return;
      }
      if (!code) {
        finish(res, 400, errorHtml("No authorization code in callback."), () =>
          reject(new Error("Callback missing authorization code.")),
        );
        return;
      }

      finish(res, 200, SUCCESS_HTML, () => resolve({ code }));
    });

    server.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Could not start callback server on port ${CALLBACK_PORT}: ${(err as Error).message}. Is it already in use?`,
        ),
      );
    });

    // Loopback only — never bind to all interfaces (DNS-rebinding safety).
    server.listen(CALLBACK_PORT, "127.0.0.1");
  });
}
