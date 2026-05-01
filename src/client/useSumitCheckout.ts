import { useCallback, useRef, useState } from "react";

import type { SumitCheckoutHandle } from "./SumitCheckout.js";

export type SumitCheckoutStatus = "idle" | "submitting" | "succeeded" | "failed";

export interface UseSumitCheckoutResult {
  ref: React.RefObject<SumitCheckoutHandle | null>;
  status: SumitCheckoutStatus;
  error: Error | null;
  token: string | null;
  submit: () => void;
  reset: () => void;
  handleToken: (token: string) => void;
  handleError: (error: Error) => void;
  handleStart: () => void;
}

export function useSumitCheckout(): UseSumitCheckoutResult {
  const ref = useRef<SumitCheckoutHandle | null>(null);
  const [status, setStatus] = useState<SumitCheckoutStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const submit = useCallback(() => {
    ref.current?.submit();
  }, []);

  const reset = useCallback(() => {
    ref.current?.reset();
    setStatus("idle");
    setError(null);
    setToken(null);
  }, []);

  const handleToken = useCallback((value: string) => {
    setToken(value);
    setStatus("succeeded");
    setError(null);
  }, []);

  const handleError = useCallback((value: Error) => {
    setError(value);
    setStatus("failed");
  }, []);

  const handleStart = useCallback(() => {
    setStatus("submitting");
    setError(null);
  }, []);

  return { ref, status, error, token, submit, reset, handleToken, handleError, handleStart };
}
