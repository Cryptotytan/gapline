import { createFileRoute } from "@tanstack/react-router";
import { parsePageSearch } from "@/lib/gapline/paths";

export const Route = createFileRoute("/_app/today")({
  validateSearch: parsePageSearch,
  component: () => null,
});
