import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SumitCheckout } from "./SumitCheckout.js";
import type { SumitCheckoutHandle } from "./SumitCheckout.js";

vi.mock("./loadPayments.js", () => ({
  loadSumitPayments: vi.fn(),
}));

const { loadSumitPayments } = await import("./loadPayments.js");
const loadMock = loadSumitPayments as unknown as ReturnType<typeof vi.fn>;

describe("SumitCheckout", () => {
  let createTokenSpy: ReturnType<typeof vi.fn>;
  let resolveLoad: (sdk: { CreateToken: typeof createTokenSpy }) => void;

  beforeEach(() => {
    createTokenSpy = vi.fn(() => undefined);
    loadMock.mockReset();
    loadMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = (sdk) => resolve(sdk as unknown as never);
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes CreateToken only once when submit() is called twice in rapid succession", async () => {
    const ref = createRef<SumitCheckoutHandle>();
    render(
      <SumitCheckout
        ref={ref}
        companyId={1}
        apiPublicKey="public-key"
        onToken={vi.fn()}
      />,
    );

    // Two rapid submits — both pass through React's batched setState before any
    // state-driven re-render runs. The synchronous ref guard should still block
    // the second call.
    act(() => {
      ref.current?.submit();
      ref.current?.submit();
    });

    await act(async () => {
      resolveLoad({ CreateToken: createTokenSpy });
    });

    expect(createTokenSpy).toHaveBeenCalledTimes(1);
  });
});
