import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { GaplineApp } from "@/components/gapline/shell";
import { parsePageSearch, viewFromPath } from "@/lib/gapline/paths";

export const Route = createFileRoute("/_app")({
  validateSearch: parsePageSearch,
  component: AppLayout,
});

function AppLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const view = viewFromPath(pathname) ?? "desk";
  return (
    <>
      <GaplineApp initialView={view} />
      <Outlet />
    </>
  );
}
