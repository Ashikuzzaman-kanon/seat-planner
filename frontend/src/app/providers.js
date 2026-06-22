"use client";

import { PrimeReactProvider } from "primereact/api";
import { AuthProvider } from "@/contexts/AuthContext";

export default function Providers({ children }) {
  return (
    <PrimeReactProvider value={{ ripple: true }}>
      <AuthProvider>{children}</AuthProvider>
    </PrimeReactProvider>
  );
}
