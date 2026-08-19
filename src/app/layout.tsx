import type { Metadata } from "next";
import { Geist, Geist_Mono, Nunito_Sans } from "next/font/google";
import { Providers } from "./providers";
import { SiteFooter } from "@/components/site-footer";
import { resolveHopeMoveUrl } from "@/lib/hope-move-url";
import "./globals.css";

/**
 * Nunito Sans is the UI face: the Hope Move platform sets its pages in
 * a rounded humanist sans, and matching that register is most of what
 * makes the dashboard feel like the platform's sibling rather than a
 * stranger's admin panel. Geist stays loaded as the fallback face and
 * Geist Mono keeps the data surfaces (cohort codes, model chips,
 * tabular numbers).
 */
const nunitoSans = Nunito_Sans({
    variable: "--font-nunito-sans",
    subsets: ["latin"],
});

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "Participant Insights Hub",
    description:
        "Facilitator dashboard for the Hope Programme. See who needs follow-up, understand why, and draft the reply.",
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
            className={`${nunitoSans.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
            suppressHydrationWarning
        >
            <body className="min-h-full flex flex-col bg-background text-text">
                <Providers hopeMoveUrl={resolveHopeMoveUrl()}>
                    {children}
                </Providers>
                <SiteFooter />
            </body>
        </html>
    );
}
