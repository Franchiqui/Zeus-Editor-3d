import { useState, useEffect, useCallback, useRef } from 'react';

export type DebounceOptions = {
  delay?: number;
  leading?: boolean;
  trailing?: boolean;
  maxWait?: number;
};

export type DebouncedFunction<T extends (...args: any[]) => any> = {
  (...args: Parameters<T>): void;
  cancel: () => void;
  flush: () => void;
  pending: () => boolean;
};

export function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  options: DebounceOptions = {}
): DebouncedFunction<T> {
  const {
    delay = 300,
    leading = false,
    trailing = true,
    maxWait,
  } = options;

  const callbackRef = useRef(callback);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const maxTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCallTimeRef = useRef<number | null>(null);
  const lastArgsRef = useRef<Parameters<T> | null>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (maxTimeoutRef.current) {
      clearTimeout(maxTimeoutRef.current);
      maxTimeoutRef.current = null;
    }
    lastCallTimeRef.current = null;
    lastArgsRef.current = null;
    pendingRef.current = false;
  }, []);

  const flush = useCallback(() => {
    if (pendingRef.current && lastArgsRef.current) {
      callbackRef.current(...lastArgsRef.current);
      cancel();
    }
  }, [cancel]);

  const pending = useCallback(() => pendingRef.current, []);

  useEffect(() => {
    return cancel;
  }, [cancel]);

  const debouncedFunction = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const isLeadingCall = leading && !pendingRef.current;

      lastArgsRef.current = args;
      lastCallTimeRef.current = now;
      pendingRef.current = true;

      if (isLeadingCall) {
        callbackRef.current(...args);
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      if (maxWait && !maxTimeoutRef.current && !isLeadingCall) {
        maxTimeoutRef.current = setTimeout(() => {
          if (pendingRef.current && lastArgsRef.current) {
            callbackRef.current(...lastArgsRef.current);
            cancel();
          }
        }, maxWait);
      }

      timeoutRef.current = setTimeout(() => {
        if (trailing && pendingRef.current && lastArgsRef.current) {
          callbackRef.current(...lastArgsRef.current);
        }
        cancel();
      }, delay);
    },
    [delay, leading, trailing, maxWait, cancel]
  );

  Object.assign(debouncedFunction, {
    cancel,
    flush,
    pending,
  });

  return debouncedFunction as DebouncedFunction<T>;
}

export function useDebounceValue<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}