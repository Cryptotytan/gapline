import { useEffect } from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

function isStaleChunk(message: string) {
  return /dynamically imported module|module script failed|Importing a module script failed/i.test(message);
}

if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: string } | undefined;
    const message = String(reason?.message ?? event.reason ?? "");
    if (!isStaleChunk(message)) return;
    if (sessionStorage.getItem("gapline.chunk-reload")) return;
    sessionStorage.setItem("gapline.chunk-reload", "1");
    window.location.reload();
  });
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const message = errorMessage(error);
  useEffect(() => {
    if (!isStaleChunk(message)) return;
    if (sessionStorage.getItem("gapline.chunk-reload")) return;
    sessionStorage.setItem("gapline.chunk-reload", "1");
    window.location.reload();
  }, [message]);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <span className="text-primary" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="font-display text-3xl">Something went wrong</h1>
      <p className="max-w-md text-sm break-words text-pretty text-muted">{message}</p>
      <button type="button" className="mt-2 h-11 rounded-full bg-primary px-5 text-sm font-medium text-primary-fg" onClick={() => window.location.reload()}>
        Reload
      </button>
    </main>
  );
}