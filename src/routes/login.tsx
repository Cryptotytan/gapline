import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { UserButton } from "@/lib/auth/gates";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg p-6 text-fg">
      <div className="w-full max-w-sm">
        <Link to="/" className="font-display text-3xl text-fg">
          Gapline
        </Link>
        <h1 className="mt-6 font-display text-4xl">Sign in</h1>
        <p className="mt-2 text-sm text-muted">Use X to open the wallet tied to that account.</p>
        <div className="mt-6 space-y-2">
          {authEnabled ? (
            GROK_PROVIDERS.filter((provider) => provider.providerId === "grok-x").map((provider) => (
              <button
                key={provider.providerId}
                type="button"
                onClick={() => signIn(provider.providerId, { callbackURL: "/desk?view=desk" })}
                className="h-11 w-full rounded-full bg-primary text-sm font-medium text-primary-fg"
              >
                Continue with {provider.label}
              </button>
            ))
          ) : (
            <p className="text-sm text-muted">Sign-in is disabled.</p>
          )}
        </div>
        <div className="mt-6">
          <UserButton />
        </div>
      </div>
    </main>
  );
}
