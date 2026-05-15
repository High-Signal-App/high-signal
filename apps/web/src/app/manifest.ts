import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "High Signal",
    short_name: "High Signal",
    description: "Evidence-backed signals from public information streams.",
    start_url: "/signals",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#22d3ee",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
