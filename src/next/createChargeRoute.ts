import {
  buildRecurringChargePayload,
  normalizeRecurringChargeResponse,
  redactSumitPayload,
} from "@digitizers/sumit-api";
import type {
  BuildRecurringChargePayloadParams,
  NormalizedSumitEvent,
  SumitCurrency,
} from "@digitizers/sumit-api";

const DEFAULT_BASE_URL = "https://api.sumit.co.il";
const DEFAULT_PATH = "/billing/recurring/charge/";

export interface SumitChargeRequestBody {
  singleUseToken: string;
  customer: {
    externalIdentifier: string;
    name: string;
    emailAddress: string;
  };
  item: {
    name: string;
    description: string;
    unitPrice: number;
    currency: SumitCurrency;
    durationMonths: number;
    quantity?: number;
    recurrence?: number;
  };
  vatIncluded?: boolean;
  onlyDocument?: boolean;
  authoriseOnly?: boolean;
}

export interface SumitChargeRouteConfig {
  companyId: number;
  apiKey: string;
  baseUrl?: string;
  path?: string;
  fetch?: typeof fetch;
  parseBody?: (body: unknown, request: Request) => SumitChargeRequestBody | Promise<SumitChargeRequestBody>;
  onResult?: (event: NormalizedSumitEvent, request: Request) => void | Promise<void>;
  onError?: (error: unknown, request: Request) => void | Promise<void>;
}

export type SumitChargeRouteHandler = (request: Request) => Promise<Response>;

export function createSumitChargeRoute(config: SumitChargeRouteConfig): SumitChargeRouteHandler {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const path = config.path ?? DEFAULT_PATH;
  const upstreamFetch = config.fetch ?? fetch;

  return async function POST(request: Request): Promise<Response> {
    let parsed: SumitChargeRequestBody;
    try {
      const raw = (await request.json()) as unknown;
      parsed = config.parseBody ? await config.parseBody(raw, request) : (raw as SumitChargeRequestBody);
    } catch (error) {
      await safeCall(config.onError, error, request);
      return jsonResponse({ ok: false, error: "Invalid request body" }, 400);
    }

    if (!parsed?.singleUseToken || !parsed.customer || !parsed.item) {
      return jsonResponse({ ok: false, error: "Missing required fields: singleUseToken, customer, item" }, 400);
    }

    const payloadParams: BuildRecurringChargePayloadParams = {
      companyId: config.companyId,
      apiKey: config.apiKey,
      customer: parsed.customer,
      singleUseToken: parsed.singleUseToken,
      item: parsed.item,
      vatIncluded: parsed.vatIncluded,
      onlyDocument: parsed.onlyDocument,
      authoriseOnly: parsed.authoriseOnly,
    };
    const payload = buildRecurringChargePayload(payloadParams);

    let upstreamJson: unknown;
    try {
      const upstream = await upstreamFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      upstreamJson = await upstream.json().catch(() => null);
    } catch (error) {
      await safeCall(config.onError, error, request);
      return jsonResponse({ ok: false, error: "Upstream request to SUMIT failed" }, 502);
    }

    const event = normalizeRecurringChargeResponse(upstreamJson);
    await safeCall(config.onResult, event, request);

    const status = event.ok === false ? 402 : 200;
    return jsonResponse(redactSumitPayload(event), status);
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function safeCall<A, B>(fn: ((a: A, b: B) => void | Promise<void>) | undefined, a: A, b: B): Promise<void> {
  if (!fn) return;
  try {
    await fn(a, b);
  } catch {
    // Swallow listener errors — the route's primary job is to respond to the caller.
  }
}
