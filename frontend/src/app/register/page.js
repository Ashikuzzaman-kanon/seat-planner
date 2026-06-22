"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InputText } from "primereact/inputtext";
import { Password } from "primereact/password";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import api from "@/lib/api";

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
      <Toast ref={toast} />
      <form className="auth-card" onSubmit={submit}>
        <h1>Create your account</h1>
        <p className="subtitle">Register with your email to get started</p>

        <div className="field-block">
          <label htmlFor="fullName">Full name</label>
          <InputText
            id="fullName"
            value={form.fullName}
            onChange={update("fullName")}
            placeholder="Jane Doe"
            required
          />
        </div>

        <div className="field-block">
          <label htmlFor="email">Email</label>
          <InputText
            id="email"
            type="email"
            value={form.email}
            onChange={update("email")}
            placeholder="you@example.com"
            required
          />
        </div>

        <div className="field-block">
          <label htmlFor="password">Password</label>
          <Password
            id="password"
            value={form.password}
            onChange={update("password")}
            toggleMask
            inputStyle={{ width: "100%" }}
            placeholder="At least 8 characters"
            required
          />
        </div>

        <Button
          type="submit"
          label="Create account"
          className="w-full"
          loading={loading}
        />

        <div className="auth-footer">
          Already registered? <Link href="/login">Sign in</Link>
        </div>
      </form>
    </div>
  );
}
