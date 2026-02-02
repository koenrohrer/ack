import { useState, useEffect } from 'react';

/**
 * Debounces a value by the specified delay.
 *
 * Returns the debounced value which only updates after the caller
 * stops changing the input for `delay` milliseconds.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
