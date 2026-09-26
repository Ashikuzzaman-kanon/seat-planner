"use client";

import { Suspense, useState, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { InputText } from "primereact/inputtext";
import { InputOtp } from "primereact/inputotp";
import { Password } from "primereact/password";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import api from "@/lib/api";
import AuthBrand from "@/components/layout/AuthBrand";
import AuthField, { PasswordStrength } from "@/components/layout/AuthField";

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useRef(null);

  const [email, setEmail] = useState(params.get("email") || "");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { email, code, newPassword });
      toast.current?.show({
        severity: "success",
        summary: "Password reset",
        detail: "You can now sign in with your new password.",
      });
      setTimeout(() => router.replace("/login"), 800);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <AuthBrand />
      <Toast ref={toast} />
      <form className="auth-card" onSubmit={submit}>
        <span className="auth-card__badge" aria-hidden="true">
          <i className="pi pi-shield" />
        </span>
        <h1>Choose a new password</h1>
        <p className="subtitle">Enter the code from your email, then your new password.</p>

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

        <AuthField label="Reset code">
          <InputOtp
            value={code}
            onChange={(e) => setCode(String(e.value ?? ""))}
            length={6}
            integerOnly
            className="auth-otp"
          />
        </AuthField>

        <AuthField
          id="newPassword"
          label="New password"
          icon="pi-lock"
          footer={<PasswordStrength value={newPassword} />}
        >
          <Password
            inputId="newPassword"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            toggleMask
            inputStyle={{ width: "100%" }}
            placeholder="At least 8 characters"
            feedback={false}
            autoComplete="new-password"
            required
          />
        </AuthField>

        <Button
          type="submit"
          label="Reset password"
          icon="pi pi-check"
          iconPos="right"
          className="w-full auth-submit"
          loading={loading}
          disabled={code.length !== 6}
        />

        <Link href="/login" className="auth-back">
          <i className="pi pi-arrow-left" aria-hidden="true" /> Back to sign in
        </Link>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="auth-shell">Loading…</div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
