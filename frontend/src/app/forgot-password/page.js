"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import api from "@/lib/api";

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
      <Toast ref={toast} />
      <form className="auth-card" onSubmit={submit}>
        <h1>Forgot password</h1>
        <p className="subtitle">We'll email you a code to reset it</p>

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

        <Button type="submit" label="Send reset code" className="w-full" loading={loading} />

        <div className="auth-footer">
          <Link href="/login">Back to sign in</Link>
        </div>
      </form>
    </div>
  );
}
