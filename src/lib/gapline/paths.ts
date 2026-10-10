import type { ViewId } from "./store";

export const PAGE_VIEW = {
  today: "desk",
  buy: "route",
  basket: "baskets",
  holdings: "holdings",
  rules: "agent",
  why: "explain",
} as const;

const VIEW_PAGE: Partial<Record<ViewId, keyof typeof PAGE_VIEW>> = {
  desk: "today",
  route: "buy",
  baskets: "basket",
  holdings: "holdings",
  agent: "rules",
  explain: "why",
};

export function viewFromPath(pathname: string): ViewId | null {
  const page = pathname.replace(/^\//, "").split("/")[0];
  if (page in PAGE_VIEW) return PAGE_VIEW[page as keyof typeof PAGE_VIEW];
  return null;
}

export function pathForView(view: ViewId): string | null {
  const page = VIEW_PAGE[view];
  return page ? `/${page}` : null;
}

export function parsePageSearch(search: Record<string, unknown>) {
  return {
    symbol: typeof search.symbol === "string" ? search.symbol : undefined,
    ...(search.x === "1" || search.x === 1 ? { x: "1" as const } : {}),
    ...(typeof search.error === "string" && search.error ? { error: search.error } : {}),
  };
}
