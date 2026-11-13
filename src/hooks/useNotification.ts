import { useMemo } from "react";
import { toast } from "@/hooks/use-toast";

export interface NotificationActions {
  success: (title: string, description?: string) => void;
  error: (title: string, error?: any) => void;
  info: (title: string, description?: string) => void;
  confirm: (message: string) => boolean;
}

/**
 * Standardized notification hook
 * Provides consistent toast notifications across the application
 */
export function useNotification(): NotificationActions {
  return useMemo(() => ({
    success: (title: string, description?: string) => {
      toast({ title, description });
    },
    error: (title: string, error?: any) => {
      const fallback = typeof error === 'string' ? error : (error?.message || "An error occurred. Please try again.");
      const t = toast({
        variant: "destructive",
        title,
        description: fallback,
      });

      // supabase-js's functions.invoke() throws a generic "Edge Function returned
      // a non-2xx status code" message on failure — the real reason the function
      // returned sits in the response body, reachable only via error.context.
      const context = (error as any)?.context;
      if (context && typeof context.json === 'function') {
        context.clone().json()
          .then((body: any) => {
            const detail = body?.error || body?.message;
            if (detail && detail !== fallback) {
              t.update({ id: t.id, variant: "destructive", title, description: detail } as any);
            }
          })
          .catch(() => {});
      }
    },
    info: (title: string, description?: string) => {
      toast({ title, description, variant: "default" });
    },
    confirm: (message: string) => {
      return window.confirm(message);
    },
  }), []);
}
