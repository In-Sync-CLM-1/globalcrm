import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

type Primitive = string | number | boolean;
type UrlValue = Primitive | string[];

function encode(value: UrlValue): string {
  if (Array.isArray(value)) return value.join(",");
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

function decode<T extends UrlValue>(raw: string, fallback: T): T {
  if (Array.isArray(fallback)) return (raw === "" ? [] : raw.split(",")) as T;
  if (typeof fallback === "boolean") return (raw === "1") as T;
  if (typeof fallback === "number") {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : fallback) as T;
  }
  return raw as T;
}

/**
 * Drop-in replacement for useState that keeps the value in the page address
 * (?key=value). The value survives the browser Back button, the in-app Back
 * button and a refresh, and the filtered view can be shared as a link.
 * Changes replace the current history entry, so Back goes to the previous
 * screen instead of stepping through every filter tweak. Pass { push: true }
 * for state that is a screen of its own (e.g. an opened document), so Back
 * returns to the previous screen within the page.
 */
type Setter<T> = (next: T | ((prev: T) => T)) => void;
type Options = { push?: boolean };

export function useUrlState(key: string, defaultValue: string, options?: Options): [string, Setter<string>];
export function useUrlState(key: string, defaultValue: number, options?: Options): [number, Setter<number>];
export function useUrlState(key: string, defaultValue: boolean, options?: Options): [boolean, Setter<boolean>];
export function useUrlState(key: string, defaultValue: string[], options?: Options): [string[], Setter<string[]>];
export function useUrlState<T extends string>(key: string, defaultValue: T, options?: Options): [T, Setter<T>];
export function useUrlState<T extends UrlValue>(
  key: string,
  defaultValue: T,
  options: Options = {},
): [T, Setter<T>] {
  const { search } = useLocation();
  const navigate = useNavigate();

  const raw = useMemo(() => new URLSearchParams(search).get(key), [search, key]);
  const defaultKey = Array.isArray(defaultValue) ? defaultValue.join(",") : defaultValue;
  const value = useMemo(
    () => (raw === null ? defaultValue : decode(raw, defaultValue)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, defaultKey],
  );

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      // Read the live address so several setters in one tick don't overwrite each other.
      const params = new URLSearchParams(window.location.search);
      const current = params.get(key);
      const prev = current === null ? defaultValue : decode(current, defaultValue);
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      const encoded = encode(resolved);
      if (encoded === encode(defaultValue)) params.delete(key);
      else params.set(key, encoded);
      const qs = params.toString();
      if (qs === window.location.search.replace(/^\?/, "")) return;
      navigate({ search: qs ? `?${qs}` : "" }, { replace: !options.push });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, navigate, defaultKey, options.push],
  );

  return [value, setValue];
}

/**
 * Object flavour of useUrlState for filter bars that keep all their fields in
 * one useState object. Each field is stored as ?<prefix>.<field>=value and the
 * type of every field is taken from its default, so strings, numbers, booleans
 * and string arrays all round-trip. Same setter shape as useState.
 */
export function useUrlObjectState<T extends object>(
  prefix: string,
  defaults: T,
  options: Options = {},
): [T, (next: T | ((prev: T) => T)) => void] {
  const { search } = useLocation();
  const navigate = useNavigate();
  const defaultsKey = JSON.stringify(defaults);
  const defs = defaults as unknown as Record<string, UrlValue>;

  const value = useMemo(() => {
    const params = new URLSearchParams(search);
    const result = { ...defs } as Record<string, UrlValue>;
    for (const k of Object.keys(defs)) {
      const raw = params.get(`${prefix}.${k}`);
      if (raw !== null) result[k] = decode(raw, defs[k]);
    }
    return result as unknown as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, prefix, defaultsKey]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const params = new URLSearchParams(window.location.search);
      const prev = { ...defs } as Record<string, UrlValue>;
      for (const k of Object.keys(defs)) {
        const raw = params.get(`${prefix}.${k}`);
        if (raw !== null) prev[k] = decode(raw, defs[k]);
      }
      const resolved = (typeof next === "function" ? (next as (p: T) => T)(prev as unknown as T) : next) as Record<string, UrlValue>;
      for (const k of Object.keys(defs)) {
        const encoded = encode(resolved[k] ?? defs[k]);
        if (encoded === encode(defs[k])) params.delete(`${prefix}.${k}`);
        else params.set(`${prefix}.${k}`, encoded);
      }
      const qs = params.toString();
      if (qs === window.location.search.replace(/^\?/, "")) return;
      navigate({ search: qs ? `?${qs}` : "" }, { replace: !options.push });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefix, navigate, defaultsKey, options.push],
  );

  return [value, setValue];
}
