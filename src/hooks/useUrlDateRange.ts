import { useCallback, useMemo } from "react";
import { format, parseISO, isValid } from "date-fns";
import {
  DateRangePreset,
  getDateRangeFromPreset,
} from "@/components/common/DateRangeFilter";
import { useUrlState } from "@/hooks/useUrlState";

type Range = { from: Date; to: Date };

const day = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * URL-backed preset + date range for DateRangeFilter. A preset is stored as
 * ?range=last_30_days; a custom range as ?range=custom&range_from=…&range_to=….
 * Survives Back / refresh and keeps the shareable-link behaviour.
 */
export function useUrlDateRange(
  defaultPreset: DateRangePreset,
  key = "range",
): [DateRangePreset, (p: DateRangePreset) => void, Range, (r: Range) => void] {
  const [preset, setPresetRaw] = useUrlState<string>(key, defaultPreset);
  const [from, setFrom] = useUrlState(`${key}_from`, "");
  const [to, setTo] = useUrlState(`${key}_to`, "");

  const range = useMemo<Range>(() => {
    if (preset === "custom" && from && to) {
      const f = parseISO(from);
      const t = parseISO(to);
      if (isValid(f) && isValid(t)) return { from: f, to: t };
    }
    return getDateRangeFromPreset(preset as DateRangePreset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, from, to]);

  const setPreset = useCallback(
    (p: DateRangePreset) => {
      setPresetRaw(p);
      if (p !== "custom") {
        setFrom("");
        setTo("");
      }
    },
    [setPresetRaw, setFrom, setTo],
  );

  const setRange = useCallback(
    (r: Range) => {
      // DateRangeFilter reports the preset's own range right after a preset
      // change; only a range that differs from it is a custom pick.
      const livePreset = (new URLSearchParams(window.location.search).get(key) ?? defaultPreset) as DateRangePreset;
      if (livePreset !== "custom") {
        const expected = getDateRangeFromPreset(livePreset);
        if (day(expected.from) === day(r.from) && day(expected.to) === day(r.to)) return;
        setPresetRaw("custom");
      }
      setFrom(day(r.from));
      setTo(day(r.to));
    },
    [key, defaultPreset, setPresetRaw, setFrom, setTo],
  );

  return [preset as DateRangePreset, setPreset, range, setRange];
}
