/**
 * Type-safe utilities for renderer-layer media data
 */

export const toSafeNumber = (val: number | string | null | undefined, defaultValue: number = 0): number => {
  if (val === null || val === undefined) return defaultValue;
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(num) ? defaultValue : num;
};

export const toSafeString = (val: string | null | undefined, defaultValue: string = 'UNKNOWN'): string => {
  return val ?? defaultValue;
};
