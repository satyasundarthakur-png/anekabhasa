import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const AnekabhasaApp = lazy(() => import("@/components/AnekabhasaApp"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Anekabhasa — Odia Document Translator" },
      {
        name: "description",
        content:
          "Translate whole Odia .docx or .pdf manuscripts into Hindi, Marathi, Gujarati, Kannada, Malayalam, Telugu, Bengali, Tamil, English, French, German, Spanish, or Russian, entirely in your browser.",
      },
      { property: "og:title", content: "Anekabhasa — Odia Document Translator" },
      {
        property: "og:description",
        content:
          "Browser-based Odia document translation (.docx or .pdf input) into 13 languages, with domain-tuned terminology and .docx output.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/social-preview.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "/social-preview.png" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly fallback={<div className="min-h-screen bg-paper" />}>
      <Suspense fallback={<div className="min-h-screen bg-paper" />}>
        <AnekabhasaApp />
      </Suspense>
    </ClientOnly>
  );
}
