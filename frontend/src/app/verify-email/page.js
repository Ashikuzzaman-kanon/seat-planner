"use client";

import { Suspense, useState, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { InputText } from "primereact/inputtext";
import { InputOtp } from "primereact/inputotp";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import api, { setToken } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

function VerifyEmailInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useRef(null);
  const { refresh } = useAuth();

  const [email, setEmail] = useState(params.get("email") || "");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/verify-email", { email, code });
      setToken(data.token);
      await refresh();
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
      <Toast ref={toast} />
      <form className="auth-card" onSubmit={submit}>
        <h1>Verify your email</h1>
        <p className="subtitle">Enter the 6-digit code we emailed you</p>

        <div className="field-block">
          <label htmlFor="email">Email</label>
          <InputText
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field-block">
          <label>Verification code</label>
          <InputOtp value={code} onChange={(e) => setCode(String(e.value))} length={6} integerOnly />
        </div>

        <Button
          type="submit"
          label="Verify"
          className="w-full"
          loading={loading}
          disabled={code.length !== 6}
        />

        <div className="auth-footer">
          <Button
            type="button"
            link
            label="Resend code"
            onClick={resend}
            loading={resending}
          />
          <div style={{ marginTop: 8 }}>
            <Link href="/login">Back to sign in</Link>
          </div>
        </div>
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
