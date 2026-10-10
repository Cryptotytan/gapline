import { createFileRoute } from "@tanstack/react-router";
import { parsePageSearch } from "@/lib/gapline/paths";

export const Route = createFileRoute("/_app/basket")({
  validateSearch: parsePageSearch,
  component: () => null,
});
