import { createFileRoute } from "@tanstack/react-router";
import { GaplineApp } from "@/components/gapline/shell";
import type { ViewId } from "@/lib/gapline/store";

const VIEWS = new Set<ViewId>(["desk", "route", "baskets", "holdings", "agent", "explain", "start", "live"]);

export const Route = createFileRoute("/desk")({
  validateSearch: (search: Record<string, unknown>): { view: ViewId; symbol?: string; x?: "1"; error?: string } => ({
    view: typeof search.view === "string" && VIEWS.has(search.view as ViewId) ? (search.view as ViewId) : "desk",
    symbol: typeof search.symbol === "string" ? search.symbol : undefined,
    ...(search.x === "1" || search.x === 1 ? { x: "1" as const } : {}),
    ...(typeof search.error === "string" && search.error ? { error: search.error } : {}),
  }),
  component: DeskPage,
});

function DeskPage() {
  const { view, symbol } = Route.useSearch();
  return <GaplineApp initialView={view} initialSymbol={symbol} />;
}
