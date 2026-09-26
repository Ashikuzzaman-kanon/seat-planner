"use client";

import { Suspense, useState, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { InputText } from "primereact/inputtext";
import { InputOtp } from "primereact/inputotp";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import AuthBrand from "@/components/layout/AuthBrand";
import AuthField from "@/components/layout/AuthField";

function VerifyEmailInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useRef(null);
  const { adoptSession } = useAuth();

  const [email, setEmail] = useState(params.get("email") || "");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/verify-email", { email, code });
      // Verification returns a full session, so there is no second sign-in step.
      adoptSession(data);
      toast.current?.show({ severity: "success", summary: "Verified!" });
      setTimeout(() => router.replace("/dashboard"), 600);
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Verification failed",
        detail: err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setResending(true);
    try {
      await api.post("/auth/resend-verification", { email });
      toast.current?.show({
        severity: "info",
        summary: "Code sent",
        detail: "Check your inbox for a new code.",
      });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="auth-shell">
      <AuthBrand />
      <Toast ref={toast} />
      <form className="auth-card" onSubmit={submit}>
        <span className="auth-card__badge" aria-hidden="true">
          <i className="pi pi-envelope" />
        </span>
        <h1>Check your inbox</h1>
        <p className="subtitle">Enter the 6-digit code we emailed you to finish creating your account.</p>

        <AuthField id="email" label="Email" icon="pi-envelope">
          <InputText
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </AuthField>

        <AuthField label="Verification code">
          <InputOtp
            value={code}
            onChange={(e) => setCode(String(e.value ?? ""))}
            length={6}
            integerOnly
            className="auth-otp"
          />
        </AuthField>

        <Button
          type="submit"
          label="Verify and continue"
          icon="pi pi-arrow-right"
          iconPos="right"
          className="w-full auth-submit"
          loading={loading}
          disabled={code.length !== 6}
        />

        <p className="auth-resend">
          Didn&apos;t get it?{" "}
          <Button
            type="button"
            link
            label="Send a new code"
            onClick={resend}
            loading={resending}
            disabled={!email}
          />
        </p>

        <Link href="/login" className="auth-back">
          <i className="pi pi-arrow-left" aria-hidden="true" /> Back to sign in
        </Link>
      </form>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="auth-shell">Loading…</div>}>
      <VerifyEmailInner />
    </Suspense>
  );
}
