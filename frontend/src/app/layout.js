import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";
// Tokens and component styling, over the PrimeReact theme.
import "./theme.css";
// After the theme, so the shared control styles win over it.
import "@/components/ui/ui.css";
import "./globals.css";
// Last, so its narrow-screen rules win over anything a page sets for a laptop.
import "./mobile.css";
import Providers from "./providers";
import { Inter } from "next/font/google";

/*
 * Inter, self-hosted by Next at build time — no request to Google from the
 * browser. Exposed as a CSS variable so the theme decides where it applies.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata = {
  title: "Seat Planner — Railway Ticketing",
  description: "Book, check and run railway journeys",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
