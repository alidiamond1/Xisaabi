import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// Display: characterful grotesque for headings & big numbers. Body: friendly, highly legible UI sans with tabular figures.
const display = Bricolage_Grotesque({ variable: "--f-display", subsets: ["latin"], display: "swap", axes: ["opsz"] });
const body = Figtree({ variable: "--f-body", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Dukaan", template: "%s · Dukaan" },
  description: "Business management for small shops",
};
export const viewport: Viewport = { themeColor: "#0e7a6c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>
        <ConvexClientProvider>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <Toaster theme="light" richColors position="top-center" />
        </ConvexClientProvider>
      </body>
    </html>
  );
}
