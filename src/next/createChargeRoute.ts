import {
  buildRecurringChargePayload,
  normalizeRecurringChargeResponse,
  redactSumitPayload,
} from "@godigitizer/sumit-api";
import type {
  BuildRecurringChargePayloadParams,
  NormalizedSumitEvent,
  SumitCurrency,
} from "@godigitizer/sumit-api";

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

    const validationError = validateChargeRequestBody(parsed);
    if (validationError) {
      return jsonResponse({ ok: false, error: validationError }, 400);
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
      if (!upstream.ok) {
        return jsonResponse({ ok: false, error: "SUMIT returned an unsuccessful response", upstreamStatus: upstream.status }, 502);
      }
    } catch (error) {
      await safeCall(config.onError, error, request);
      return jsonResponse({ ok: false, error: "Upstream request to SUMIT failed" }, 502);
    }

    const event = normalizeRecurringChargeResponse(upstreamJson);
    if (event.ok === null || event.eventType === "sumit.trigger.unmapped") {
      return jsonResponse({ ok: false, error: "SUMIT returned an unmapped charge response", event: redactSumitPayload(event) }, 502);
    }
    await safeCall(config.onResult, event, request);

    const status = event.ok === false ? 402 : 200;
    return jsonResponse(redactSumitPayload(event), status);
  };
}

function validateChargeRequestBody(body: SumitChargeRequestBody): string | null {
  if (!isNonEmptyString(body.singleUseToken)) return "singleUseToken must be a non-empty string";
  if (!isNonEmptyString(body.customer.externalIdentifier)) return "customer.externalIdentifier must be a non-empty string";
  if (!isNonEmptyString(body.customer.name)) return "customer.name must be a non-empty string";
  if (!isNonEmptyString(body.customer.emailAddress)) return "customer.emailAddress must be a non-empty string";
  if (!isNonEmptyString(body.item.name)) return "item.name must be a non-empty string";
  if (!isNonEmptyString(body.item.description)) return "item.description must be a non-empty string";
  if (!isPositiveFiniteNumber(body.item.unitPrice)) return "item.unitPrice must be a positive number";
  if (!isPositiveFiniteNumber(body.item.durationMonths)) return "item.durationMonths must be a positive number";
  if (!["ILS", "USD", "EUR", 0, 1, 2].includes(body.item.currency)) return "item.currency must be one of ILS, USD, EUR, 0, 1, 2";
  if (body.item.quantity !== undefined && !isPositiveFiniteNumber(body.item.quantity)) return "item.quantity must be a positive number";
  if (body.item.recurrence !== undefined && !isNonNegativeFiniteNumber(body.item.recurrence)) return "item.recurrence must be a non-negative number";
  return null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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
