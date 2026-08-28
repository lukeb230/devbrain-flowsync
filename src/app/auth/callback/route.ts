import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/server";

// OAuth code exchange. On first sign-in, provision a personal org and
// membership so the user lands on a working dashboard.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Where to land: ?next= from the sign-in button, else the devbrain_next
  // cookie it set (the desktop panel relies on this — it must return to
  // /widget, never /dashboard, which the panel opens in the browser).
  const cookieNext = (() => {
    const m = /(?:^|;\s*)devbrain_next=([^;]+)/.exec(request.headers.get("cookie") ?? "");
    try { return m ? decodeURIComponent(m[1]) : ""; } catch { return ""; }
  })();
  const nextRaw = searchParams.get("next") || cookieNext || "";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/dashboard";

  if (code) {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const admin = supabaseAdmin();

      // Allowlist = DEVBRAIN_ALLOWED_LOGINS (env) ∪ allowed_members (table).
      // Additive on purpose: the Members page can add people without a Vercel
      // redeploy, and adopting the table can never lock out the env list.
      // Both empty = open instance (dev only).
      const envAllowed = (process.env.DEVBRAIN_ALLOWED_LOGINS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const { data: memberRows } = await admin.from("allowed_members").select("login");
      const dbAllowed = (memberRows ?? []).map((r) => String(r.login).toLowerCase());
      const allowed = new Set([...envAllowed, ...dbAllowed]);
      if (allowed.size > 0) {
        const login = (
          (data.user.user_metadata?.user_name as string | undefined) ?? ""
        ).toLowerCase();
        if (!allowed.has(login)) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/?denied=1`);
        }
      }
      const { data: memberships } = await admin
        .from("org_members")
        .select("org_id")
        .eq("user_id", data.user.id)
        .limit(1);

      if (!memberships || memberships.length === 0) {
        const login =
          (data.user.user_metadata?.user_name as string | undefined) ??
          data.user.email?.split("@")[0] ??
          "team";
        // Single-team instance: an allowlisted newcomer JOINS the existing
        // team org (so they see the same repos, tasks, and brain as everyone
        // else). Only the very first user ever bootstraps a new org.
        const { data: existingOrg } = await admin
          .from("orgs")
          .select("id")
          .order("created_at")
          .limit(1)
          .single();
        if (existingOrg) {
          await admin.from("org_members").insert({
            org_id: existingOrg.id,
            user_id: data.user.id,
            role: "member",
            github_login: login,
          });
        } else {
          const slug = `${login}-${data.user.id.slice(0, 6)}`.toLowerCase();
          const { data: org } = await admin
            .from("orgs")
            .insert({ name: `${login}'s team`, slug })
            .select("id")
            .single();
          if (org) {
            await admin.from("org_members").insert({
              org_id: org.id,
              user_id: data.user.id,
              role: "owner",
              github_login: login,
            });
          }
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/?auth_error=1`);
}
