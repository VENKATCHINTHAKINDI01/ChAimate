import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "./globals.css";
import Nav from "@/components/layout/Nav";
import Footer from "@/components/layout/Footer";
import Cursor from "@/components/layout/Cursor";
import SmoothScroll from "@/components/layout/SmoothScroll";

const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-cormorant", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Deccan House — Specialty Coffee & Contemporary Cuisine, Jubilee Hills", template: "%s · Deccan House" },
  description: "A contemporary café where Hyderabad's heritage meets modern culinary culture. Specialty coffee, slow food and quiet moments in Jubilee Hills, Hyderabad.",
  openGraph: { title: "Deccan House", description: "A different kind of café. Jubilee Hills, Hyderabad.", type: "website", locale: "en_IN" },
  icons: { icon: "/favicon.svg" },
};
export const viewport: Viewport = { themeColor: "#11100e", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${cormorant.variable} ${manrope.variable}`}>
      <body className="grain">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:bg-cream focus:px-4 focus:py-2 focus:text-ink">Skip to content</a>
        <SmoothScroll />
        <Cursor />
        <Nav />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
