import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  const clerkConfigured = Boolean(
    // biome-ignore lint/complexity/useLiteralKeys: TS noPropertyAccessFromIndexSignature requires bracket access here.
    process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] &&
      // biome-ignore lint/complexity/useLiteralKeys: TS noPropertyAccessFromIndexSignature requires bracket access here.
      process.env['CLERK_SECRET_KEY']
  );

  if (!clerkConfigured) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
          sign in unavailable
        </div>
        <h1 className="mt-3 text-2xl font-medium tracking-tight">
          Auth is not configured locally.
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
          The app is still usable in public mode. Add Clerk keys to enable account-specific pages.
        </p>
        <a
          href="/"
          className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
        >
          back home
        </a>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <SignIn />
    </main>
  );
}
