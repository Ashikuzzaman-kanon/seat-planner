"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InputText } from "primereact/inputtext";
import { Password } from "primereact/password";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { useAuth } from "@/contexts/AuthContext";

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
      <Toast ref={toast} />
      <form className="auth-card" onSubmit={submit}>
        <h1>Welcome back</h1>
        <p className="subtitle">Sign in to the Train Seat Planner</p>

        <div className="field-block">
          <label htmlFor="email">Email</label>
          <InputText
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </div>

        <div className="field-block">
          <label htmlFor="password">Password</label>
          <Password
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            feedback={false}
            toggleMask
            inputStyle={{ width: "100%" }}
            placeholder="Your password"
            required
          />
        </div>

        <Button
          type="submit"
          label="Sign in"
          className="w-full"
          loading={loading}
        />

        <div className="auth-footer">
          <Link href="/forgot-password">Forgot password?</Link>
          <div style={{ marginTop: 8 }}>
            No account? <Link href="/register">Create one</Link>
          </div>
        </div>
      </form>
    </div>
  );
}
