import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// Display: characterful grotesque for headings & big numbers. Body: friendly, highly legible UI sans with tabular figures.
const display = Bricolage_Grotesque({ variable: "--f-display", subsets: ["latin"], display: "swap", axes: ["opsz"] });
const body = Figtree({ variable: "--f-body", subsets: ["latin"], display: "swap" });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://xisabsax.netlify.app";
const title = "XisabSax — Simple, correct bookkeeping for your shop";
const description = "XisabSax (Xisaab sax ah, ganacsi fudud) is a simple app to run your shop from your phone: sales, stock, customer credit, expenses and profit. Works even without internet. Start free.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: title, template: "%s · XisabSax" },
  description,
  openGraph: { type: "website", siteName: "XisabSax", title, description, locale: "en", images: [{ url: "/og.png", width: 1080, height: 1080 }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
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
