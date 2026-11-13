import * as React from "react";
import { Tabs } from "@/components/ui/tabs";
import { useUrlState } from "@/hooks/useUrlState";

type UrlTabsProps = Omit<React.ComponentPropsWithoutRef<typeof Tabs>, "value" | "defaultValue" | "onValueChange"> & {
  defaultValue: string;
  /** Address parameter that stores the active tab. Use a distinct name per Tabs on a screen. */
  param?: string;
};

/**
 * Tabs whose active tab lives in the page address (?tab=…), so the selection
 * survives Back, refresh and shared links.
 */
export function UrlTabs({ defaultValue, param = "tab", ...props }: UrlTabsProps) {
  const [value, setValue] = useUrlState(param, defaultValue);
  return <Tabs {...props} value={value} onValueChange={setValue} />;
}
