import { normalizeSumitIncomingPayload, redactSumitPayload } from "@digitizers/sumit-api";
import type { NormalizedSumitEvent } from "@digitizers/sumit-api";

export type SumitWebhookVerifier = (request: Request) => boolean | Promise<boolean>;

export interface SumitWebhookRouteConfig {
  onEvent: (event: NormalizedSumitEvent, request: Request) => void | Promise<void>;
  verify?: SumitWebhookVerifier;
  onError?: (error: unknown, request: Request) => void | Promise<void>;
}

export type SumitWebhookRouteHandler = (request: Request) => Promise<Response>;

export function createSumitWebhookRoute(config: SumitWebhookRouteConfig): SumitWebhookRouteHandler {
  return async function POST(request: Request): Promise<Response> {
    if (config.verify) {
      let allowed = false;
      try {
        allowed = await config.verify(request);
      } catch (error) {
        await safeCall(config.onError, error, request);
        return new Response("Unauthorized", { status: 401 });
      }
      if (!allowed) return new Response("Unauthorized", { status: 401 });
    }

    let payload: unknown;
    try {
      payload = await readPayload(request);
    } catch (error) {
      await safeCall(config.onError, error, request);
      return new Response("Invalid body", { status: 400 });
    }

    const event = normalizeSumitIncomingPayload(payload);

    try {
      await config.onEvent(event, request);
    } catch (error) {
      await safeCall(config.onError, error, request);
      return new Response(JSON.stringify({ ok: false, eventType: event.eventType, error: "Handler failed" }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    return new Response(JSON.stringify({ ok: true, eventType: event.eventType, event: redactSumitPayload(event) }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };
}

export function verifySumitSharedSecret(secret: string, options: { header?: string; queryParam?: string } = {}): SumitWebhookVerifier {
  const headerName = (options.header ?? "x-sumit-secret").toLowerCase();
  const queryParam = options.queryParam ?? "secret";
  return (request) => {
    const headerValue = request.headers.get(headerName);
    if (headerValue && timingSafeEqual(headerValue, secret)) return true;
    const url = new URL(request.url);
    const queryValue = url.searchParams.get(queryParam);
    return Boolean(queryValue && timingSafeEqual(queryValue, secret));
  };
}

async function readPayload(request: Request): Promise<unknown> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) {
    return (await request.json()) as unknown;
  }
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const body = await request.text();
    return new URLSearchParams(body);
  }
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return new URLSearchParams(text);
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function safeCall<A, B>(fn: ((a: A, b: B) => void | Promise<void>) | undefined, a: A, b: B): Promise<void> {
  if (!fn) return;
  try {
    await fn(a, b);
  } catch {
    // Listener errors must not surface to SUMIT — they would trigger retries.
  }
}
