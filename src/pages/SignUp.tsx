import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNotification } from "@/hooks/useNotification";
import { Eye, EyeOff, CheckCircle2, Loader2 } from "lucide-react";
import logo from "@/assets/logo.png";
import backgroundImage from "@/assets/login-background-new.jpeg";

type OtpStatus = "idle" | "sending" | "sent" | "verifying" | "verified";

export default function SignUp() {
  const navigate = useNavigate();
  const notify = useNotification();
  const [searchParams] = useSearchParams();
  const inviteCode = searchParams.get("invite");
  const [loading, setLoading] = useState(false);
  const [inviteData, setInviteData] = useState<any>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    organizationName: "",
    organizationSlug: "",
  });

  // OTP state
  const [emailOtp, setEmailOtp] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");
  const [emailOtpStatus, setEmailOtpStatus] = useState<OtpStatus>("idle");
  const [phoneOtpStatus, setPhoneOtpStatus] = useState<OtpStatus>("idle");
  const [emailSessionId, setEmailSessionId] = useState<string | null>(null);
  const [phoneSessionId, setPhoneSessionId] = useState<string | null>(null);
  const [emailResendTimer, setEmailResendTimer] = useState(0);
  const [phoneResendTimer, setPhoneResendTimer] = useState(0);

  // Refs for auto-verify
  const emailSessionRef = useRef(emailSessionId);
  const phoneSessionRef = useRef(phoneSessionId);
  emailSessionRef.current = emailSessionId;
  phoneSessionRef.current = phoneSessionId;

  useEffect(() => {
    if (emailResendTimer <= 0) return;
    const t = setTimeout(() => setEmailResendTimer(emailResendTimer - 1), 1000);
    return () => clearTimeout(t);
  }, [emailResendTimer]);

  useEffect(() => {
    if (phoneResendTimer <= 0) return;
    const t = setTimeout(() => setPhoneResendTimer(phoneResendTimer - 1), 1000);
    return () => clearTimeout(t);
  }, [phoneResendTimer]);

  useEffect(() => {
    if (inviteCode) fetchInviteDetails();
  }, [inviteCode]);

  const fetchInviteDetails = async () => {
    try {
      // One invite, looked up by its code (the invite list itself is not readable without a sign-in).
      const { data: rows, error } = await (supabase.rpc as any)("get_invite_by_code", { p_code: inviteCode });
      if (error) throw error;
      const data = Array.isArray(rows) ? rows[0] : null;
      if (data) {
        setInviteData({ ...data, organizations: { name: data.org_name, slug: data.org_slug } });
        if (data.email) setFormData(prev => ({ ...prev, email: data.email }));
      } else {
        notify.error("Invalid invite", new Error("This invite link is invalid or has expired"));
      }
    } catch {
      notify.error("Error", new Error("Failed to load invite details"));
    }
  };

  // Track whether OTP was already sent to prevent duplicates
  const emailOtpSentFor = useRef("");
  const phoneOtpSentFor = useRef("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (name === "organizationName") {
      const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      setFormData(prev => ({ ...prev, organizationSlug: slug }));
    }
    // Auto-send phone OTP when 10 digits entered
    if (name === "phone") {
      const clean = value.replace(/\D/g, "");
      if (clean.length === 10 && /^[6-9]/.test(clean) && phoneOtpSentFor.current !== clean) {
        phoneOtpSentFor.current = clean;
        // Slight delay so state updates
        setTimeout(() => sendOtpForValue("phone", clean), 100);
      }
    }
  };

  // Auto-send email OTP on blur
  const handleEmailBlur = () => {
    const email = formData.email.trim().toLowerCase();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && emailOtpStatus === "idle" && emailOtpSentFor.current !== email) {
      emailOtpSentFor.current = email;
      sendOtpForValue("email", email);
    }
  };

  const sendOtpForValue = async (type: "email" | "phone", value: string) => {
    const setStatus = type === "email" ? setEmailOtpStatus : setPhoneOtpStatus;
    const setSessionId = type === "email" ? setEmailSessionId : setPhoneSessionId;
    const setTimer = type === "email" ? setEmailResendTimer : setPhoneResendTimer;

    setStatus("sending");
    try {
      const body = type === "email"
        ? { type: "email", email: value }
        : { type: "phone", phone: value };

      const { data, error } = await supabase.functions.invoke("send-otp", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setSessionId(data.sessionId);
      setStatus("sent");
      setTimer(30);

      if (data.isTestMode && data.testOtp) {
        notify.success("Test Mode", `OTP: ${data.testOtp}`);
      } else {
        notify.success("OTP Sent", type === "email" ? "Check your email" : "Check your WhatsApp");
      }
    } catch (err: any) {
      setStatus("idle");
      // Reset sentFor so they can retry
      if (type === "email") emailOtpSentFor.current = "";
      else phoneOtpSentFor.current = "";
      notify.error("Failed to send OTP", err);
    }
  };

  const resendOtp = (type: "email" | "phone") => {
    if (type === "email") {
      emailOtpSentFor.current = "";
      setEmailOtp("");
      sendOtpForValue("email", formData.email.trim().toLowerCase());
    } else {
      phoneOtpSentFor.current = "";
      setPhoneOtp("");
      sendOtpForValue("phone", formData.phone.replace(/\D/g, ""));
    }
  };

  const verifyOtp = useCallback(async (type: "email" | "phone", otpValue: string) => {
    const sessionId = type === "email" ? emailSessionRef.current : phoneSessionRef.current;
    const setStatus = type === "email" ? setEmailOtpStatus : setPhoneOtpStatus;

    if (!sessionId || otpValue.length !== 6) return;

    setStatus("verifying");
    try {
      const { data, error } = await supabase.functions.invoke("verify-otp", {
        body: { sessionId, otp: otpValue },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.verified) {
        setStatus("verified");
        notify.success("Verified!", type === "email" ? "Email verified" : "Phone verified");
      }
    } catch (err: any) {
      setStatus("sent");
      notify.error("Verification failed", err);
    }
  }, [notify]);

  // Auto-verify when 6 digits entered
  const handleEmailOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, "").slice(0, 6);
    setEmailOtp(val);
    if (val.length === 6 && emailOtpStatus === "sent") {
      verifyOtp("email", val);
    }
  };

  const handlePhoneOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, "").slice(0, 6);
    setPhoneOtp(val);
    if (val.length === 6 && phoneOtpStatus === "sent") {
      verifyOtp("phone", val);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (emailOtpStatus !== "verified" || phoneOtpStatus !== "verified") {
      notify.error("Verification required", new Error("Please verify both email and phone number"));
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      notify.error("Passwords don't match", new Error("Please make sure your passwords match"));
      return;
    }
    if (formData.password.length < 6) {
      notify.error("Password too short", new Error("Password must be at least 6 characters"));
      return;
    }

    setLoading(true);
    let createdUserId: string | null = null;

    try {
      if (inviteData) {
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: {
              first_name: formData.firstName,
              last_name: formData.lastName,
              phone: `+91${formData.phone.replace(/\D/g, "")}`,
              // The database checks this code and adds the person to the inviting organisation.
              invite_code: inviteCode,
            },
          },
        });
        if (authError) throw authError;
        if (!authData.user) throw new Error("No user returned");

        notify.success("Account created!", `Welcome to ${inviteData.organizations.name}`);
      } else {
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
          options: {
            emailRedirectTo: `${window.location.origin}/onboarding`,
            data: {
              first_name: formData.firstName,
              last_name: formData.lastName,
              phone: `+91${formData.phone.replace(/\D/g, "")}`,
            },
          },
        });
        if (authError) throw new Error(`Failed to create account: ${authError.message}`);
        if (!authData.user) throw new Error("No user returned from signup");

        createdUserId = authData.user.id;
        await new Promise(resolve => setTimeout(resolve, 3000));

        const { error: orgError } = await supabase.rpc("create_organization_for_user", {
          p_user_id: authData.user.id,
          p_org_name: formData.organizationName,
          p_org_slug: formData.organizationSlug,
        });

        if (orgError) {
          await supabase.rpc("cleanup_orphaned_profile", { user_id: createdUserId });
          throw new Error(orgError.message || "Failed to create organization");
        }

        notify.success("Account created!", "Welcome to In-Sync");
      }

      navigate(inviteData ? "/dashboard" : "/onboarding");
    } catch (error: any) {
      console.error("Signup error:", error);
      notify.error("Sign up failed", error);
    } finally {
      setLoading(false);
    }
  };

  const pageTitle = inviteData ? `Join ${inviteData.organizations.name}` : "Create your account";
  const pageSubtitle = inviteData ? "Complete your registration to join the team" : "Start your journey with In-Sync";

  const bothVerified = emailOtpStatus === "verified" && phoneOtpStatus === "verified";

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-cover bg-center bg-no-repeat overflow-y-auto"
      style={{ backgroundImage: `url(${backgroundImage})` }}
    >
      <div className="absolute inset-0 bg-black/30" />

      <div className="relative z-10 my-6 w-full max-w-md rounded-2xl bg-card/95 p-6 shadow-2xl backdrop-blur-sm">
        <div className="mb-4 text-center">
          <img
            src={logo}
            alt="In-Sync Logo"
            className="mx-auto mb-2 h-14 w-14 object-contain"
            style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.15)) brightness(1.05)" }}
          />
          <h2 className="text-xl font-bold text-foreground">{pageTitle}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{pageSubtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-2">
          {inviteData && (
            <div className="rounded-md bg-primary/10 p-2.5 text-sm">
              You're joining <strong>{inviteData.organizations.name}</strong> as a{" "}
              <strong>{inviteData.role.replace("_", " ")}</strong>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <Label htmlFor="firstName" className="text-xs">First Name</Label>
              <Input id="firstName" name="firstName" value={formData.firstName} onChange={handleChange} required className="h-8 text-sm" />
            </div>
            <div className="space-y-0.5">
              <Label htmlFor="lastName" className="text-xs">Last Name</Label>
              <Input id="lastName" name="lastName" value={formData.lastName} onChange={handleChange} required className="h-8 text-sm" />
            </div>
          </div>

          {/* Email with auto OTP */}
          <div className="space-y-1">
            <Label htmlFor="email" className="text-xs">Email</Label>
            <div className="flex items-center gap-2">
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                onBlur={handleEmailBlur}
                disabled={!!inviteData?.email || emailOtpStatus === "verified"}
                required
                className="h-8 flex-1 text-sm"
              />
              {emailOtpStatus === "verified" && (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
              )}
              {emailOtpStatus === "sending" && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              {emailOtpStatus === "idle" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 px-3 text-xs"
                  disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())}
                  onClick={() => {
                    const email = formData.email.trim().toLowerCase();
                    emailOtpSentFor.current = email;
                    sendOtpForValue("email", email);
                  }}
                >
                  Send code
                </Button>
              )}
            </div>
            {(emailOtpStatus === "sent" || emailOtpStatus === "verifying") && (
              <div className="space-y-1">
                <div className="relative">
                  <Input
                    placeholder="Enter 6-digit email OTP"
                    value={emailOtp}
                    onChange={handleEmailOtpChange}
                    maxLength={6}
                    className="h-8 text-sm tracking-widest"
                    disabled={emailOtpStatus === "verifying"}
                    autoFocus
                  />
                  {emailOtpStatus === "verifying" && (
                    <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => resendOtp("email")}
                  disabled={emailResendTimer > 0}
                  className="text-[11px] text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                >
                  {emailResendTimer > 0 ? `Resend in ${emailResendTimer}s` : "Resend code"}
                </button>
              </div>
            )}
          </div>

          {/* Phone with auto OTP */}
          <div className="space-y-1">
            <Label htmlFor="phone" className="text-xs">Mobile Number</Label>
            <div className="flex items-center gap-2">
              <div className="flex h-8 items-center rounded-md border border-input bg-muted px-2 text-xs text-muted-foreground">
                +91
              </div>
              <Input
                id="phone"
                name="phone"
                type="tel"
                placeholder="9876543210"
                value={formData.phone}
                onChange={handleChange}
                maxLength={10}
                required
                disabled={phoneOtpStatus === "verified"}
                className="h-8 flex-1 text-sm"
              />
              {phoneOtpStatus === "verified" && (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
              )}
              {phoneOtpStatus === "sending" && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              {phoneOtpStatus === "idle" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 px-3 text-xs"
                  disabled={!/^[6-9]\d{9}$/.test(formData.phone.replace(/\D/g, ""))}
                  onClick={() => {
                    const clean = formData.phone.replace(/\D/g, "");
                    phoneOtpSentFor.current = clean;
                    sendOtpForValue("phone", clean);
                  }}
                >
                  Send code
                </Button>
              )}
            </div>
            {(phoneOtpStatus === "sent" || phoneOtpStatus === "verifying") && (
              <div className="space-y-1">
                <div className="relative">
                  <Input
                    placeholder="Enter 6-digit WhatsApp OTP"
                    value={phoneOtp}
                    onChange={handlePhoneOtpChange}
                    maxLength={6}
                    className="h-8 text-sm tracking-widest"
                    disabled={phoneOtpStatus === "verifying"}
                    autoFocus
                  />
                  {phoneOtpStatus === "verifying" && (
                    <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => resendOtp("phone")}
                  disabled={phoneResendTimer > 0}
                  className="text-[11px] text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                >
                  {phoneResendTimer > 0 ? `Resend in ${phoneResendTimer}s` : "Resend code"}
                </button>
              </div>
            )}
          </div>

          {!inviteData && (
            <>
              <div className="space-y-0.5">
                <Label htmlFor="organizationName" className="text-xs">Organization Name</Label>
                <Input id="organizationName" name="organizationName" value={formData.organizationName} onChange={handleChange} required className="h-8 text-sm" />
              </div>
              <div className="space-y-0.5">
                <Label htmlFor="organizationSlug" className="text-xs">Organization ID (URL)</Label>
                <Input id="organizationSlug" name="organizationSlug" value={formData.organizationSlug} onChange={handleChange} required className="h-8 text-sm" />
                <p className="text-[10px] text-muted-foreground">insync.app/{formData.organizationSlug}</p>
              </div>
            </>
          )}

          <div className="space-y-0.5">
            <Label htmlFor="password" className="text-xs">Password</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                value={formData.password}
                onChange={handleChange}
                required
                className="h-8 pr-9 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="space-y-0.5">
            <Label htmlFor="confirmPassword" className="text-xs">Confirm Password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                className="h-8 pr-9 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="!mt-3 w-full" disabled={loading || !bothVerified}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating account...
              </>
            ) : !bothVerified ? (
              "Verify email & phone to continue"
            ) : (
              "Create Account"
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </p>
        </form>

        <p className="mt-3 text-center text-[10px] text-muted-foreground">
          © 2025 In-Sync. All rights reserved.
        </p>
      </div>
    </div>
  );
}
