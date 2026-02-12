import { supabase } from "../lib/supabaseClient";

export default async function Home() {
  const { data: foods, error } = await supabase
    .from("foods_global")
    .select("id,name,price_per_100g")
    .order("name", { ascending: true })
    .limit(20);

  return (
    <main style={{ padding: 24 }}>
      <h1>Nutrition Platform</h1>

      {error ? (
        <p style={{ color: "crimson" }}>Error loading foods: {error.message}</p>
      ) : (
        <>
          <p>Loaded {foods?.length ?? 0} foods from Supabase.</p>
          <ul>
            {(foods || []).map((f) => (
              <li key={f.id}>
                {f.name}
                {f.price_per_100g != null ? ` — €${f.price_per_100g}/100g` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
