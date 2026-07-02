import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
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
          sign up unavailable
        </div>
        <h1 className="mt-3 text-2xl font-medium tracking-tight">
          Auth is not configured locally.
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
          Public pages continue to render. Add Clerk keys to enable account creation.
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
      <SignUp />
    </main>
  );
}
