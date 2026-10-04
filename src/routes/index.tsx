import { createFileRoute } from "@tanstack/react-router";
import { Landing } from "@/components/gapline/landing";

export const Route = createFileRoute("/")({ component: Landing });
