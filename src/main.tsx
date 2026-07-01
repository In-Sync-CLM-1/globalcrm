import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.tsx";
import "./index.css";
import ErrorBoundary from "./components/ErrorBoundary";
import { setupErrorLogging } from "./lib/errorLogger";

// Set up global error logging
setupErrorLogging();

// lazyRetry (App.tsx) sets this before forcing a reload to recover from a
// stale chunk after a deploy, but only allows one reload per tab lifetime.
// Clear it on every fresh page load so a later deploy (same long-lived tab)
// can still trigger its own one-time recovery reload instead of getting
// stuck failing forever.
sessionStorage.removeItem("chunk_reload");

// When a fresh service worker takes control after a deploy, force a one-time reload
// so the open tab/PWA picks up the new JS bundle instead of serving the cached one.
if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

// Configure React Query with optimal caching
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes - data stays fresh
      gcTime: 10 * 60 * 1000, // 10 minutes - cache time (formerly cacheTime)
      refetchOnWindowFocus: false, // Prevent unnecessary refetches
      retry: 1, // Only retry once on failure
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </QueryClientProvider>
);
