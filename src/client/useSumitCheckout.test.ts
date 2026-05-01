import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSumitCheckout } from "./useSumitCheckout.js";

describe("useSumitCheckout", () => {
  it("can mark success without storing a SingleUseToken", () => {
    const { result } = renderHook(() => useSumitCheckout());

    act(() => {
      result.current.handleSuccess();
    });

    expect(result.current.status).toBe("succeeded");
    expect(result.current.token).toBeNull();
  });

  it("can clear a stored token after legacy handleToken usage", () => {
    const { result } = renderHook(() => useSumitCheckout());

    act(() => {
      result.current.handleToken("tok_xyz");
      result.current.clearToken();
    });

    expect(result.current.status).toBe("succeeded");
    expect(result.current.token).toBeNull();
  });
});
