"use client";

import { PrimeReactProvider } from "primereact/api";
import { AuthProvider } from "@/contexts/AuthContext";
import HoverTitles from "@/components/ui/HoverTitles";

export default function Providers({ children }) {
  return (
    <PrimeReactProvider value={{ ripple: true }}>
      <AuthProvider>{children}</AuthProvider>
      <HoverTitles />
    </PrimeReactProvider>
  );
}
