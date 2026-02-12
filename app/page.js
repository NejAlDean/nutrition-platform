export const dynamic = "force-dynamic";
export const revalidate = 0;

import { supabase } from "../lib/supabaseClient";

export default async function Home() {
  // 1) Fetch foods (and also fetch an exact count so we can see if RLS blocks count vs data)
  const { data: foods, error, count } = await supabase
    .from("foods_global")
    .select("id,name,price_per_100g", { count: "exact" })
    .order("name", { ascending: true })
    .limit(20);

  // 2) If something is wrong with env vars or auth, the error will show here
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, Arial" }}>
      <h1 style={{ marginBottom: 8 }}>Nutrition Platform</h1>

      <div style={{ marginBottom: 16, fontSize: 14, color: "#444" }}>
        <div>
          <strong>Supabase URL present:</strong>{" "}
          {process.env.NEXT_PUBLIC_SUPABASE_URL ? "Yes" : "No"}
        </div>
        <div>
          <strong>Anon key present:</strong>{" "}
          {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "Yes" : "No"}
        </div>
      </div>

      {error ? (
        <div style={{ padding: 12, border: "1px solid #ffb3b3", background: "#fff2f2" }}>
          <p style={{ color: "crimson", margin: 0 }}>
            <strong>Error loading foods:</strong> {error.message}
          </p>
          <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>
            This usually means one of these:
            <br />- Wrong env variables in Vercel (URL or anon key)
            <br />- RLS policy blocks anon SELECT
            <br />- You’re connected to a different Supabase project than the one you seeded
          </p>
        </div>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            Loaded <strong>{foods?.length ?? 0}</strong> foods from Supabase.
            {typeof count === "number" ? (
              <>
                {" "}
                Total visible rows: <strong>{count}</strong>
              </>
            ) : null}
          </p>

          {(foods?.length ?? 0) === 0 ? (
            <div style={{ padding: 12, border: "1px solid #ddd", background: "#fafafa" }}>
              <p style={{ margin: 0 }}>
                No rows returned. If you see rows in Supabase Table Editor but the site shows 0, then it’s
                almost always:
              </p>
              <ul style={{ marginTop: 8 }}>
                <li>
                  Vercel is using a different <strong>NEXT_PUBLIC_SUPABASE_URL</strong> than the project you
                  seeded
                </li>
                <li>
                  RLS policy doesn’t allow <strong>anon</strong> (public) reads, even if you think it does
                </li>
              </ul>
            </div>
          ) : (
            <ul>
              {foods.map((f) => (
                <li key={f.id}>
                  {f.name}
                  {f.price_per_100g != null ? ` — €${Number(f.price_per_100g)}/100g` : ""}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
