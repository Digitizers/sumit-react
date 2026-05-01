import { describe, expect, it, vi } from "vitest";

import { createSumitChargeRoute } from "./createChargeRoute.js";

const validBody = {
  singleUseToken: "tok_abc",
  customer: {
    externalIdentifier: "org_123",
    name: "Acme Ltd",
    emailAddress: "billing@example.com",
  },
  item: {
    name: "Pro",
    description: "Pro monthly",
    unitPrice: 19,
    currency: "USD" as const,
    durationMonths: 1,
  },
};

function jsonRequest(body: unknown): Request {
  return new Request("https://example.com/api/sumit/charge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("createSumitChargeRoute", () => {
  it("returns 400 when body is invalid JSON", async () => {
    const handler = createSumitChargeRoute({ companyId: 1, apiKey: "k" });
    const response = await handler(
      new Request("https://example.com/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when required fields are missing", async () => {
    const handler = createSumitChargeRoute({ companyId: 1, apiKey: "k" });
    const response = await handler(jsonRequest({ singleUseToken: "tok" }));
    expect(response.status).toBe(400);
  });

  it("forwards a built payload to the SUMIT base URL and normalizes the response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ Payment: { ValidPayment: true, Status: "000" }, RecurringCustomerItemIDs: ["444"], CustomerID: "1", DocumentID: "9" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const onResult = vi.fn();
    const handler = createSumitChargeRoute({ companyId: 7, apiKey: "k", fetch: fetchMock as unknown as typeof fetch, onResult });

    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.eventType).toBe("recurring.charged");
    expect(json.ok).toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sumit.co.il/billing/recurring/charge/");
    expect(init.method).toBe("POST");
    const sentBody = JSON.parse(init.body as string) as { Credentials: { CompanyID: number; APIKey: string }; SingleUseToken: string };
    expect(sentBody.Credentials).toEqual({ CompanyID: 7, APIKey: "k" });
    expect(sentBody.SingleUseToken).toBe("tok_abc");

    expect(onResult).toHaveBeenCalledOnce();
  });

  it("returns 402 when SUMIT reports a failure", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ Payment: { ValidPayment: false, Status: "001" }, UserErrorMessage: "כרטיס נדחה" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const handler = createSumitChargeRoute({ companyId: 7, apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(402);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.eventType).toBe("payment.failed");
    expect(json.ok).toBe(false);
  });

  it("returns 502 when SUMIT responds with a non-2xx status", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ UserErrorMessage: "temporary provider failure" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
    const handler = createSumitChargeRoute({ companyId: 7, apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(502);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.ok).toBe(false);
    expect(json.error).toBe("SUMIT returned an unsuccessful response");
  });

  it("returns 502 when a direct charge response cannot be mapped to a billing result", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ unexpected: "shape" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const handler = createSumitChargeRoute({ companyId: 7, apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(502);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.ok).toBe(false);
    expect(json.error).toBe("SUMIT returned an unmapped charge response");
  });

  it("returns 400 when nested charge fields are invalid", async () => {
    const fetchMock = vi.fn();
    const handler = createSumitChargeRoute({ companyId: 7, apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    const response = await handler(jsonRequest({ ...validBody, item: { ...validBody.item, unitPrice: "19" } }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.error).toContain("item.unitPrice");
  });

  it("returns 502 when the upstream call throws", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network");
    });
    const onError = vi.fn();
    const handler = createSumitChargeRoute({ companyId: 7, apiKey: "k", fetch: fetchMock as unknown as typeof fetch, onError });
    const response = await handler(jsonRequest(validBody));
    expect(response.status).toBe(502);
    expect(onError).toHaveBeenCalledOnce();
  });

  describe("mode: oneOff", () => {
    const oneOffBody = {
      singleUseToken: "tok_one_off",
      customer: validBody.customer,
      item: { name: "Setup fee", description: "One-time", unitPrice: 49, currency: "USD" as const },
    };

    it("targets /billing/payments/charge/ and sends a payload without Duration_Months", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ Payment: { ID: 111, ValidPayment: true, Status: "000" }, CustomerID: "1", DocumentID: "9" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const handler = createSumitChargeRoute({ companyId: 7, apiKey: "k", mode: "oneOff", fetch: fetchMock as unknown as typeof fetch });
      const response = await handler(jsonRequest(oneOffBody));

      expect(response.status).toBe(200);
      const json = (await response.json()) as Record<string, unknown>;
      expect(json.eventType).toBe("payment.succeeded");
      expect(json.ok).toBe(true);
      expect(json.recurringItemId).toBeUndefined();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.sumit.co.il/billing/payments/charge/");
      const sentBody = JSON.parse(init.body as string) as { Items: Array<Record<string, unknown>> };
      expect(sentBody.Items[0]).not.toHaveProperty("Duration_Months");
      expect(sentBody.Items[0]).not.toHaveProperty("Recurrence");
      expect((sentBody.Items[0].Item as Record<string, unknown>)).not.toHaveProperty("Duration_Months");
    });

    it("does not require durationMonths in one-off mode", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ Payment: { ValidPayment: true, Status: "000" }, CustomerID: "1" }), { status: 200 }),
      );
      const handler = createSumitChargeRoute({ companyId: 7, apiKey: "k", mode: "oneOff", fetch: fetchMock as unknown as typeof fetch });
      const response = await handler(jsonRequest(oneOffBody));
      expect(response.status).toBe(200);
    });

    it("rejects recurring requests missing durationMonths with a 400", async () => {
      const fetchMock = vi.fn();
      const handler = createSumitChargeRoute({ companyId: 7, apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
      const { durationMonths: _drop, ...itemWithoutDuration } = validBody.item;
      const response = await handler(jsonRequest({ ...validBody, item: itemWithoutDuration }));
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
      const json = (await response.json()) as Record<string, unknown>;
      expect(json.error).toContain("item.durationMonths");
    });
  });
});
