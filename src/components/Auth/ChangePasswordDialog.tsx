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

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string | undefined;
  /** Called after the password is changed; the caller signs the user out and sends them to the login page. */
  onChanged: () => void;
}

// Lets a signed-in user change their own password (every organisation).
// The current password is checked first so an unattended, signed-in screen
// cannot be used to take over the account. Same 8-character minimum as the
// Forgot password flow on the login page, which stays as it is.
// After the change the user is signed out (on every device) and asked to sign
// in again with the new password.
export function ChangePasswordDialog({ open, onOpenChange, email, onChanged }: ChangePasswordDialogProps) {
  const notify = useNotification();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setCurrent("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      notify.error("Password too short", new Error("Password must be at least 8 characters long"));
      return;
    }
    if (password !== confirmPassword) {
      notify.error("Passwords don't match", new Error("Please make sure both new passwords are the same"));
      return;
    }
    if (password === current) {
      notify.error("Same password", new Error("Choose a new password that is different from the current one"));
      return;
    }
    if (!email) {
      notify.error("Error", new Error("Your sign-in email could not be read. Please sign in again."));
      return;
    }

    setLoading(true);
    try {
      const { error: checkError } = await supabase.auth.signInWithPassword({ email, password: current });
      if (checkError) {
        notify.error("Current password is wrong", new Error("Please check your current password and try again"));
        return;
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      onOpenChange(false);
      reset();
      onChanged();
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
          <DialogTitle>Change Password</DialogTitle>
          <DialogDescription>Enter your current password, then choose a new one.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="change-current-password">Current Password</Label>
            <Input
              id="change-current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-new-password">New Password</Label>
            <Input
              id="change-new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="change-confirm-password">Confirm New Password</Label>
            <Input
              id="change-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Changing..." : "Change Password"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
