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
      <Toast ref={toast} />
      <form className="auth-card" onSubmit={submit}>
        <h1>Reset password</h1>
        <p className="subtitle">Enter the code and your new password</p>

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
          <label>Reset code</label>
          <InputOtp value={code} onChange={(e) => setCode(String(e.value))} length={6} integerOnly />
        </div>

        <div className="field-block">
          <label htmlFor="newPassword">New password</label>
          <Password
            id="newPassword"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            toggleMask
            inputStyle={{ width: "100%" }}
            placeholder="At least 8 characters"
            required
          />
        </div>

        <Button
          type="submit"
          label="Reset password"
          className="w-full"
          loading={loading}
          disabled={code.length !== 6}
        />

        <div className="auth-footer">
          <Link href="/login">Back to sign in</Link>
        </div>
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
