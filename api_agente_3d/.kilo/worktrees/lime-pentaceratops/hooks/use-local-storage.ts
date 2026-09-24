'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export type LocalStorageValue<T> = T | null;

export interface UseLocalStorageOptions<T> {
  serializer?: (value: T) => string;
  deserializer?: (value: string) => T;
  onError?: (error: Error) => void;
}

export interface UseLocalStorageReturn<T> {
  value: LocalStorageValue<T>;
  setValue: (newValue: T | ((prev: LocalStorageValue<T>) => T)) => void;
  removeValue: () => void;
  isPersistent: boolean;
}

const defaultSerializer = <T>(value: T): string => {
  return JSON.stringify(value);
};

const defaultDeserializer = <T>(value: string): T => {
  return JSON.parse(value);
};

const isBrowser = typeof window !== 'undefined';

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options: UseLocalStorageOptions<T> = {}
): UseLocalStorageReturn<T> {
  const {
    serializer = defaultSerializer,
    deserializer = defaultDeserializer,
    onError,
  } = options;

  const [storedValue, setStoredValue] = useState<LocalStorageValue<T>>(() => {
    if (!isBrowser) return initialValue;

    try {
      const item = window.localStorage.getItem(key);
      return item ? deserializer(item) : initialValue;
    } catch (error) {
      onError?.(error as Error);
      return initialValue;
    }
  });

  const [isPersistent, setIsPersistent] = useState(true);
  const initialValueRef = useRef(initialValue);
  const keyRef = useRef(key);

  const setValue = useCallback(
    (newValue: T | ((prev: LocalStorageValue<T>) => T)) => {
      if (!isBrowser) return;

      try {
        const valueToStore =
          newValue instanceof Function ? newValue(storedValue) : newValue;

        setStoredValue(valueToStore);
        window.localStorage.setItem(key, serializer(valueToStore));
        setIsPersistent(true);
      } catch (error) {
        onError?.(error as Error);
        setIsPersistent(false);
      }
    },
    [key, storedValue, serializer, onError]
  );

  const removeValue = useCallback(() => {
    if (!isBrowser) return;

    try {
      window.localStorage.removeItem(key);
      setStoredValue(initialValueRef.current);
      setIsPersistent(true);
    } catch (error) {
      onError?.(error as Error);
      setIsPersistent(false);
    }
  }, [key, onError]);

  useEffect(() => {
    if (!isBrowser) return;

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === keyRef.current && event.storageArea === localStorage) {
        try {
          const newValue = event.newValue
            ? deserializer(event.newValue)
            : initialValueRef.current;
          setStoredValue(newValue);
        } catch (error) {
          onError?.(error as Error);
        }
      }
    };

    const checkPersistency = () => {
      try {
        const testKey = `__persistence_test_${Date.now()}__`;
        window.localStorage.setItem(testKey, 'test');
        window.localStorage.removeItem(testKey);
        setIsPersistent(true);
      } catch {
        setIsPersistent(false);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    checkPersistency();

    const intervalId = setInterval(checkPersistency, 10000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(intervalId);
    };
  }, [deserializer, onError]);

  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  useEffect(() => {
    if (!isBrowser) return;

    try {
      const item = window.localStorage.getItem(key);
      if (item !== null) {
        setStoredValue(deserializer(item));
      }
    } catch (error) {
      onError?.(error as Error);
    }
  }, [key, deserializer, onError]);

  return {
    value: storedValue,
    setValue,
    removeValue,
    isPersistent,
  };
}

export function useLocalStorageArray<T>(
  key: string,
  initialValue: T[] = []
): UseLocalStorageReturn<T[]> & {
  addItem: (item: T) => void;
  removeItem: (index: number) => void;
  updateItem: (index: number, item: T) => void;
  clearAll: () => void;
} {
  const { value, setValue, removeValue, isPersistent } = useLocalStorage<T[]>(
    key,
    initialValue
  );

  const addItem = useCallback(
    (item: T) => {
      setValue((prev) => [...(prev || []), item]);
    },
    [setValue]
  );

  const removeItem = useCallback(
    (index: number) => {
      setValue((prev) => {
        const array = prev || [];
        if (index < 0 || index >= array.length) return array;
        return [...array.slice(0, index), ...array.slice(index + 1)];
      });
    },
    [setValue]
  );

  const updateItem = useCallback(
    (index: number, item: T) => {
      setValue((prev) => {
        const array = prev || [];
        if (index < 0 || index >= array.length) return array;
        return [...array.slice(0, index), item, ...array.slice(index + 1)];
      });
    },
    [setValue]
  );

  const clearAll = useCallback(() => {
    setValue([]);
  }, [setValue]);

  return {
    value,
    setValue,
    removeValue,
    isPersistent,
    addItem,
    removeItem,
    updateItem,
    clearAll,
  };
}

export function useLocalStorageObject<T extends Record<string, any>>(
  key: string,
  initialValue: T
): UseLocalStorageReturn<T> & {
  updateField: <K extends keyof T>(field: K, value: T[K]) => void;
  removeField: (field: keyof T) => void;
} {
  const { value, setValue, removeValue, isPersistent } = useLocalStorage<T>(
    key,
    initialValue
  );

  const updateField = useCallback(
    <K extends keyof T>(field: K, fieldValue: T[K]) => {
      setValue((prev) => ({
        ...(prev || initialValue),
        [field]: fieldValue,
      }));
    },
    [setValue, initialValue]
  );

  const removeField = useCallback(
    (field: keyof T) => {
      setValue((prev) => {
        if (!prev) return initialValue;
        const { [field]: _, ...rest } = prev;
        return rest as T;
      });
    },
    [setValue, initialValue]
  );

  return {
    value,
    setValue,
    removeValue,
    isPersistent,
    updateField,
    removeField,
  };
}