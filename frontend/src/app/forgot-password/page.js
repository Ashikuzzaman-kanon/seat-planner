"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import api from "@/lib/api";
import AuthBrand from "@/components/layout/AuthBrand";
import AuthField from "@/components/layout/AuthField";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const toast = useRef(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      toast.current?.show({
        severity: "success",
        summary: "Check your email",
        detail: "If the account exists, a reset code is on its way.",
      });
      setTimeout(
        () => router.push(`/reset-password?email=${encodeURIComponent(email)}`),
        800
      );
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
          <i className="pi pi-key" />
        </span>
        <h1>Forgot your password?</h1>
        <p className="subtitle">Enter your email and we will send a 6-digit code to reset it.</p>

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

        <Button type="submit" label="Send reset code" icon="pi pi-send" iconPos="right" className="w-full auth-submit" loading={loading} />

        <Link href="/login" className="auth-back">
          <i className="pi pi-arrow-left" aria-hidden="true" /> Back to sign in
        </Link>
      </form>
    </div>
  );
}
