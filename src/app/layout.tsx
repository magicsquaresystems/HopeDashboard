import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "Hope Facilitator Assistant",
    description:
        "Facilitator-facing dashboard for the Hope Programme — dropout risk + AI-drafted follow-up.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        // suppressHydrationWarning: browser extensions (e.g. SwiftRead) and
        // theme scripts mutate <html> attributes/style before React hydrates,
        // which otherwise trips a hydration mismatch. This suppresses the
        // warning for this element's own attributes only (one level deep) —
        // it does NOT hide mismatches in the tree below.
        <html
            lang="en"
            className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
            suppressHydrationWarning
        >
            <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
