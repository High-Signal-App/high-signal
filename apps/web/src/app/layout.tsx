import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { AnalyticsProvider } from "@/components/posthog-provider";
import { SaaSMakerFeedback } from "@/components/saasmaker-feedback";
import { VitalsReporter } from "@/components/VitalsReporter";
import { AuthNav } from "@/components/auth/AuthNav";
import { PrimaryNav } from "@/components/system/PrimaryNav";
import { SiteFooter } from "@/components/system/SiteFooter";
import { SiteOrganizationJsonLd } from "@/components/seo/structured-data";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_TWITTER,
  SITE_URL,
} from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  keywords: [
    "daily brief",
    "stocks",
    "startups",
    "finance",
    "technology",
    "ai signals",
    "hit-rate",
    "evidence-first",
    "market intelligence",
    "agent evaluation",
  ],
  alternates: {
    canonical: SITE_URL,
    types: {
      "application/rss+xml": [
        { url: `${SITE_URL}/signals/rss`, title: "High Signal — published signals" },
        { url: `${SITE_URL}/digest/rss`, title: "High Signal — weekly digest" },
      ],
      "application/atom+xml": [
        { url: `${SITE_URL}/signals/atom`, title: "High Signal — published signals (atom)" },
        { url: `${SITE_URL}/digest/atom`, title: "High Signal — weekly digest (atom)" },
      ],
    },
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    locale: "en_US",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} — Daily Brief`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    creator: SITE_TWITTER,
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const clerkConfigured = Boolean(
    process.env["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"] && process.env["CLERK_SECRET_KEY"],
  );
  const app = (
    <AnalyticsProvider>
      <PrimaryNav />
      {clerkConfigured ? <AuthNav /> : null}
      {children}
      <SiteFooter />
      <SaaSMakerFeedback />
      <VitalsReporter />
    </AnalyticsProvider>
  );

  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">
        <SiteOrganizationJsonLd />
        {clerkConfigured ? <ClerkProvider>{app}</ClerkProvider> : app}
      </body>
    </html>
  );
}
