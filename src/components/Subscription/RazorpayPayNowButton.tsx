import { useEffect } from "react";

declare global { interface Window { __rzp__?: { init?: () => void } } }

const EMBED_SCRIPT_ID = "razorpay-embed-btn-js";

export function RazorpayPayNowButton({ className }: { className?: string }) {
  useEffect(() => {
    if (!document.getElementById(EMBED_SCRIPT_ID)) {
      const s = document.createElement("script");
      s.defer = true;
      s.id = EMBED_SCRIPT_ID;
      s.src = "https://cdn.razorpay.com/static/embed_btn/bundle.js";
      document.body.appendChild(s);
    } else {
      window.__rzp__?.init?.();
    }
  }, []);

  return (
    <div
      className={`razorpay-embed-btn ${className || ""}`}
      data-url="https://pages.razorpay.com/pl_TISeIrLPj3DG2I/view"
      data-text="Pay Now"
      data-color="#528FF0"
      data-size="large"
    />
  );
}
