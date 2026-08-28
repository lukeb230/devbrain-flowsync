"use client";

import { supabaseBrowser } from "@/lib/supabase/client";

export function SignInButton({ next }: { next?: string }) {
  async function signIn() {
    const supabase = supabaseBrowser();
    // Remember where to land after OAuth in a cookie too: the desktop panel
    // must come back to /widget, and the query-string hint alone can be lost
    // between the provider hops. The callback reads either.
    if (next) document.cookie = `devbrain_next=${encodeURIComponent(next)}; path=/; max-age=600; samesite=lax`;
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`,
      },
    });
  }

  return (
    <button
      onClick={signIn}
      className="rounded-lg bg-brand-600 px-6 py-3 font-medium text-white transition hover:bg-brand-700"
    >
      Sign in with GitHub
    </button>
  );
}
