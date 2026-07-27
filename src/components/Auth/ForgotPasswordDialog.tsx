import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotification } from "@/hooks/useNotification";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ForgotPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ForgotPasswordDialog({ open, onOpenChange }: ForgotPasswordDialogProps) {
  const notify = useNotification();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setStep("email");
    setEmail("");
    setSessionId("");
    setOtp("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("request-password-otp", {
        body: { email },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setSessionId(data.sessionId);
      setStep("otp");
      notify.success("Check your email and WhatsApp", "Enter the verification code to set a new password");
    } catch (error: any) {
      notify.error("Error", error);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      notify.error("Passwords don't match", new Error("Please make sure both passwords are the same"));
      return;
    }
    if (password.length < 8) {
      notify.error("Password too short", new Error("Password must be at least 8 characters long"));
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("reset-password-with-otp", {
        body: { sessionId, otp, newPassword: password },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      notify.success("Password updated", "Your password has been reset — you can now log in");
      onOpenChange(false);
      reset();
    } catch (error: any) {
      notify.error("Error", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>
            {step === "email"
              ? "Enter your email address and we'll send a verification code to your email and WhatsApp (if a number is on file)."
              : "Enter the verification code and choose a new password."}
          </DialogDescription>
        </DialogHeader>

        {step === "email" ? (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@example.com"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending..." : "Send Code"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-otp">Verification Code</Label>
              <Input
                id="reset-otp"
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="6-digit code"
                maxLength={6}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-new-password">New Password</Label>
              <Input
                id="reset-new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-confirm-password">Confirm New Password</Label>
              <Input
                id="reset-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Resetting..." : "Reset Password"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setStep("email")} disabled={loading}>
              Use a different email
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
