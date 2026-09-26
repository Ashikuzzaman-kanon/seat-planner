"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InputText } from "primereact/inputtext";
import { Password } from "primereact/password";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { useAuth } from "@/contexts/AuthContext";
import AuthBrand from "@/components/layout/AuthBrand";
import AuthField from "@/components/layout/AuthField";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const toast = useRef(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      router.replace("/dashboard");
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Login failed",
        detail: err.message,
      });
      // Unverified users get a shortcut to finish verification.
      if (/verify/i.test(err.message)) {
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <AuthBrand />
      <Toast ref={toast} />
      <form className="auth-card" onSubmit={submit}>
        <p className="auth-card__eyebrow">Sign in</p>
        <h1>Welcome back</h1>
        <p className="subtitle">Sign in to book, check or manage tickets.</p>

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

        <AuthField
          id="password"
          label="Password"
          icon="pi-lock"
          aside={
            <Link href="/forgot-password" className="auth-field__aside">
              Forgot password?
            </Link>
          }
        >
          <Password
            inputId="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            feedback={false}
            toggleMask
            inputStyle={{ width: "100%" }}
            placeholder="Your password"
            autoComplete="current-password"
            required
          />
        </AuthField>

        <Button
          type="submit"
          label="Sign in"
          icon="pi pi-arrow-right"
          iconPos="right"
          className="w-full auth-submit"
          loading={loading}
        />

        <div className="auth-divider">
          <span>New here?</span>
        </div>

        <Link href="/register" className="auth-alt">
          <i className="pi pi-user-plus" aria-hidden="true" /> Create an account
        </Link>

        <p className="auth-legal">
          <Link href="/privacy">Privacy</Link>
        </p>
      </form>
    </div>
  );
}
