"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient"; // ✅ correct path (lib is next to app)

function round2(n) {
  if (n == null || Number.isNaN(n)) return 0;
  return Math.round(n * 100) / 100;
}

export default function Home() {
  const [foods, setFoods] = useState([]);
  const [foodsLoading, setFoodsLoading] = useState(true);
  const [foodsError, setFoodsError] = useState(null);

  const [query, setQuery] = useState("");
  const [selectedFoodId, setSelectedFoodId] = useState("");
  const [grams, setGrams] = useState(100);

  const [entries, setEntries] = useState([]); // [{ id, food_id, name, grams }]

  const [nutrientsById, setNutrientsById] = useState({}); // nutrient_id -> {name, unit}
  const [foodNutrients, setFoodNutrients] = useState([]); // rows: {food_id, nutrient_id, amount_per_100g}

  const supabaseUrlPresent = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonPresent = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 1) Load foods (global) once
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setFoodsLoading(true);
      setFoodsError(null);

      const { data, error } = await supabase
        .from("foods_global")
        .select("id,name,price_per_100g")
        .order("name", { ascending: true });

      if (cancelled) return;

      if (error) {
        setFoodsError(error.message);
        setFoods([]);
      } else {
        setFoods(data || []);
      }

      setFoodsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Filter foods for dropdown
  const filteredFoods = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return foods.slice(0, 200);
    return foods
      .filter((f) => (f.name || "").toLowerCase().includes(q))
      .slice(0, 200);
  }, [foods, query]);

  // Helper: id -> name
  const foodNameById = useMemo(() => {
    const map = {};
    for (const f of foods) map[f.id] = f.name;
    return map;
  }, [foods]);

  // 2) When entries change, load nutrients for those foods + metadata
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const foodIds = Array.from(new Set(entries.map((e) => e.food_id)));
      if (foodIds.length === 0) {
        setFoodNutrients([]);
        setNutrientsById({});
        return;
      }

      // ✅ FIX: column is amount_per_100g (not value_per_100g)
      const { data: fnData, error: fnError } = await supabase
        .from("food_nutrients_global")
        .select("food_id,nutrient_id,amount_per_100g")
        .in("food_id", foodIds);

      if (cancelled) return;

      if (fnError) {
        console.error(fnError);
        setFoodNutrients([]);
        setNutrientsById({});
        return;
      }

      const rows = fnData || [];
      setFoodNutrients(rows);

      const nutrientIds = Array.from(new Set(rows.map((r) => r.nutrient_id)));
      if (nutrientIds.length === 0) {
        setNutrientsById({});
        return;
      }

      // ✅ FIX: nutrients table uses display_name (not name)
      const { data: nData, error: nError } = await supabase
        .from("nutrients")
        .select("id,display_name,unit")
        .in("id", nutrientIds);

      if (cancelled) return;

      if (nError) {
        console.error(nError);
        setNutrientsById({});
        return;
      }

      const meta = {};
      for (const n of nData || []) {
        meta[n.id] = { name: n.display_name, unit: n.unit };
      }
      setNutrientsById(meta);
    })();

    return () => {
      cancelled = true;
    };
  }, [entries]);

  // 3) Compute totals per nutrient based on entries + foodNutrients
  const totals = useMemo(() => {
    const gramsByFood = {};
    for (const e of entries) {
      gramsByFood[e.food_id] =
        (gramsByFood[e.food_id] || 0) + Number(e.grams || 0);
    }

    const sumByNutrient = {}; // nutrient_id -> totalValue
    for (const row of foodNutrients) {
      const g = gramsByFood[row.food_id] || 0;
      if (!g) continue;

      // ✅ FIX: amount_per_100g
      const v100 = Number(row.amount_per_100g || 0);
      const add = (v100 * g) / 100;

      sumByNutrient[row.nutrient_id] =
        (sumByNutrient[row.nutrient_id] || 0) + add;
    }

    const list = Object.entries(sumByNutrient).map(([nutrient_id, value]) => {
      const meta = nutrientsById[nutrient_id] || {};
      return {
        nutrient_id,
        name: meta.name || `Nutrient ${nutrient_id}`,
        unit: meta.unit || "",
        total: value,
      };
    });

    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return list;
  }, [entries, foodNutrients, nutrientsById]);

  function addEntry() {
    const g = Number(grams);
    if (!selectedFoodId) return;
    if (!Number.isFinite(g) || g <= 0) return;

    const name = foodNameById[selectedFoodId] || "Unknown food";

    setEntries((prev) => [
      ...prev,
      {
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : String(Date.now()) + Math.random(),
        food_id: selectedFoodId,
        name,
        grams: g,
      },
    ]);
  }

  function removeEntry(entryId) {
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, Arial" }}>
      <h1 style={{ marginBottom: 8 }}>Nutrition Platform</h1>

      <div style={{ marginBottom: 16 }}>
        <div>Supabase URL present: {supabaseUrlPresent ? "Yes" : "No"}</div>
        <div>Anon key present: {supabaseAnonPresent ? "Yes" : "No"}</div>
      </div>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Add food</h2>

        {foodsLoading ? (
          <p>Loading foods…</p>
        ) : foodsError ? (
          <p style={{ color: "crimson" }}>Error loading foods: {foodsError}</p>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div style={{ minWidth: 280 }}>
                <label style={{ display: "block", fontWeight: 600 }}>
                  Search
                </label>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Type to filter foods…"
                  style={{ width: "100%", padding: 8 }}
                />
              </div>

              <div style={{ minWidth: 320 }}>
                <label style={{ display: "block", fontWeight: 600 }}>
                  Food
                </label>
                <select
                  value={selectedFoodId}
                  onChange={(e) => setSelectedFoodId(e.target.value)}
                  style={{ width: "100%", padding: 8 }}
                >
                  <option value="">Select a food…</option>
                  {filteredFoods.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                  Showing {filteredFoods.length} foods (max 200 in dropdown)
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontWeight: 600 }}>
                  Grams
                </label>
                <input
                  type="number"
                  value={grams}
                  onChange={(e) => setGrams(e.target.value)}
                  min={1}
                  step={1}
                  style={{ width: 140, padding: 8 }}
                />
              </div>

              <div style={{ marginTop: 22 }}>
                <button
                  onClick={addEntry}
                  style={{ padding: "10px 14px", cursor: "pointer" }}
                >
                  Add
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Diet entries</h2>

          {entries.length === 0 ? (
            <p>No entries yet. Add a food + grams.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {entries.map((e) => (
                <li key={e.id} style={{ marginBottom: 6 }}>
                  {e.name} — {e.grams}g{" "}
                  <button onClick={() => removeEntry(e.id)} style={{ marginLeft: 8 }}>
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Totals (calculated)</h2>

          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>
            This sums: amount_per_100g × grams/100 across your selected foods.
          </div>

          {entries.length === 0 ? (
            <p>Add entries to see totals.</p>
          ) : totals.length === 0 ? (
            <p>No nutrient rows found for these foods (check food_nutrients_global).</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 6 }}>
                    Nutrient
                  </th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 6 }}>
                    Total
                  </th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 6 }}>
                    Unit
                  </th>
                </tr>
              </thead>
              <tbody>
                {totals.map((t) => (
                  <tr key={t.nutrient_id}>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 6 }}>
                      {t.name}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f3f3f3",
                        padding: 6,
                        textAlign: "right",
                      }}
                    >
                      {round2(t.total)}
                    </td>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 6 }}>
                      {t.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}
