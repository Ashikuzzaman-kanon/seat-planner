"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InputText } from "primereact/inputtext";
import { Password } from "primereact/password";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import api from "@/lib/api";
import AuthBrand from "@/components/layout/AuthBrand";
import AuthField, { PasswordStrength } from "@/components/layout/AuthField";

export default function RegisterPage() {
  const router = useRouter();
  const toast = useRef(null);
  const [form, setForm] = useState({ fullName: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);

  const update = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/register", form);
      toast.current?.show({
        severity: "success",
        summary: "Check your email",
        detail: "We sent you a verification code.",
      });
      setTimeout(
        () => router.push(`/verify-email?email=${encodeURIComponent(form.email)}`),
        800
      );
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Registration failed",
        detail: err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <AuthBrand />
      <Toast ref={toast} />
      <form className="auth-card" onSubmit={submit}>
        <p className="auth-card__eyebrow">Create account</p>
        <h1>Start travelling</h1>
        <p className="subtitle">One account for booking, your wallet and your tickets.</p>

        <AuthField id="fullName" label="Full name" icon="pi-user">
          <InputText
            id="fullName"
            value={form.fullName}
            onChange={update("fullName")}
            placeholder="Jane Doe"
            autoComplete="name"
            required
          />
        </AuthField>

        <AuthField id="email" label="Email" icon="pi-envelope">
          <InputText
            id="email"
            type="email"
            value={form.email}
            onChange={update("email")}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </AuthField>

        <AuthField
          id="password"
          label="Password"
          icon="pi-lock"
          footer={<PasswordStrength value={form.password} />}
        >
          <Password
            inputId="password"
            value={form.password}
            onChange={update("password")}
            feedback={false}
            toggleMask
            inputStyle={{ width: "100%" }}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
          />
        </AuthField>

        <Button
          type="submit"
          label="Create account"
          icon="pi pi-arrow-right"
          iconPos="right"
          className="w-full auth-submit"
          loading={loading}
        />

        <p className="auth-fine">
          We will email you a 6-digit code to confirm the address before you can sign in.
        </p>

        <div className="auth-divider">
          <span>Already registered?</span>
        </div>

        <Link href="/login" className="auth-alt">
          <i className="pi pi-sign-in" aria-hidden="true" /> Sign in instead
        </Link>

        <p className="auth-legal">
          By creating an account you agree to how your data is handled — see <Link href="/privacy">Privacy</Link>.
        </p>
      </form>
    </div>
  );
}
