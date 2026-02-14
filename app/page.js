"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient"; // lib is next to app

function round2(n) {
  if (n == null || Number.isNaN(n)) return 0;
  return Math.round(n * 100) / 100;
}

// Which nutrients you want as columns (spreadsheet style)
// These must match nutrients.key in your Supabase table `nutrients`.
const DEFAULT_VISIBLE_KEYS = [
  "calories",
  "protein",
  "carbs",
  "fat",
  "fiber",
  "sugar",
  "omega_3",
  "omega_6",
  "cholesterol",
  "sodium",
];

export default function Home() {
  // Foods list
  const [foods, setFoods] = useState([]);
  const [foodsLoading, setFoodsLoading] = useState(true);
  const [foodsError, setFoodsError] = useState(null);

  // Search + add
  const [query, setQuery] = useState("");
  const [selectedFoodId, setSelectedFoodId] = useState("");
  const [grams, setGrams] = useState(100);

  // Entries in "diet"
  const [entries, setEntries] = useState([]); // [{ id, food_id, name, grams }]

  // Nutrient metadata + nutrient rows for selected foods
  const [nutrientsById, setNutrientsById] = useState({}); // id -> { key, name, unit }
  const [nutrientIdByKey, setNutrientIdByKey] = useState({}); // key -> id
  const [foodNutrients, setFoodNutrients] = useState([]); // { food_id, nutrient_id, amount_per_100g }

  // UI: visible nutrient columns (by key)
  const [visibleKeys, setVisibleKeys] = useState(DEFAULT_VISIBLE_KEYS);

  // UI: goals for each nutrient key
  const [goalsByKey, setGoalsByKey] = useState(() => {
    const obj = {};
    for (const k of DEFAULT_VISIBLE_KEYS) obj[k] = "";
    return obj;
  });

  const supabaseUrlPresent = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonPresent = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // ----------------------------
  // A) Load all foods (global)
  // ----------------------------
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

  // Dropdown foods filtered
  const filteredFoods = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return foods.slice(0, 200);
    return foods
      .filter((f) => (f.name || "").toLowerCase().includes(q))
      .slice(0, 200);
  }, [foods, query]);

  // id -> name
  const foodNameById = useMemo(() => {
    const map = {};
    for (const f of foods) map[f.id] = f.name;
    return map;
  }, [foods]);

  // ----------------------------
  // B) Load nutrient meta once
  // ----------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Load all nutrients (we need key + display_name + unit)
      const { data, error } = await supabase
        .from("nutrients")
        .select("id,key,display_name,unit");

      if (cancelled) return;

      if (error) {
        console.error("nutrients load error:", error);
        setNutrientsById({});
        setNutrientIdByKey({});
        return;
      }

      const byId = {};
      const byKey = {};

      for (const n of data || []) {
        byId[n.id] = {
          key: n.key,
          name: n.display_name || n.key,
          unit: n.unit || "",
        };
        if (n.key) byKey[n.key] = n.id;
      }

      setNutrientsById(byId);
      setNutrientIdByKey(byKey);

      // Auto-fix: remove keys that do not exist in DB
      setVisibleKeys((prev) => prev.filter((k) => !!byKey[k]));
      setGoalsByKey((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (!byKey[k]) delete next[k];
        }
        // Ensure we have goal fields for current visible keys
        for (const k of DEFAULT_VISIBLE_KEYS) {
          if (byKey[k] && next[k] === undefined) next[k] = "";
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ----------------------------
  // C) When entries change, load nutrient rows for those foods
  // ----------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const foodIds = Array.from(new Set(entries.map((e) => e.food_id)));
      if (foodIds.length === 0) {
        setFoodNutrients([]);
        return;
      }

      const { data: fnData, error: fnError } = await supabase
        .from("food_nutrients_global")
        .select("food_id,nutrient_id,amount_per_100g")
        .in("food_id", foodIds);

      if (cancelled) return;

      if (fnError) {
        console.error(fnError);
        setFoodNutrients([]);
        return;
      }

      setFoodNutrients(fnData || []);
    })();

    return () => {
      cancelled = true;
    };
  }, [entries]);

  // ----------------------------
  // D) Build a fast lookup: food_id -> nutrient_id -> amount_per_100g
  // ----------------------------
  const amount100ByFoodNutrient = useMemo(() => {
    const map = {}; // food_id -> { nutrient_id: amount_per_100g }
    for (const row of foodNutrients) {
      if (!map[row.food_id]) map[row.food_id] = {};
      map[row.food_id][row.nutrient_id] = Number(row.amount_per_100g || 0);
    }
    return map;
  }, [foodNutrients]);

  // ----------------------------
  // E) Spreadsheet rows (each entry becomes one row)
  // ----------------------------
  const spreadsheetRows = useMemo(() => {
    return entries.map((e) => {
      const foodMap = amount100ByFoodNutrient[e.food_id] || {};
      const gramsNum = Number(e.grams || 0);

      // For each visible nutrient key, compute value
      const valuesByKey = {};
      for (const key of visibleKeys) {
        const nid = nutrientIdByKey[key];
        const amount100 = nid ? Number(foodMap[nid] || 0) : 0;
        valuesByKey[key] = (amount100 * gramsNum) / 100;
      }

      return { ...e, grams: gramsNum, valuesByKey };
    });
  }, [entries, amount100ByFoodNutrient, visibleKeys, nutrientIdByKey]);

  // ----------------------------
  // F) Totals row per nutrient key
  // ----------------------------
  const totalsByKey = useMemo(() => {
    const totals = {};
    for (const k of visibleKeys) totals[k] = 0;
    for (const row of spreadsheetRows) {
      for (const k of visibleKeys) {
        totals[k] += Number(row.valuesByKey[k] || 0);
      }
    }
    return totals;
  }, [spreadsheetRows, visibleKeys]);

  // ----------------------------
  // Actions
  // ----------------------------
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

  function updateEntryGrams(entryId, newGrams) {
    const g = Number(newGrams);
    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, grams: g } : e))
    );
  }

  function updateGoal(key, value) {
    setGoalsByKey((prev) => ({ ...prev, [key]: value }));
  }

  // ----------------------------
  // Styling (simple, clean)
  // ----------------------------
  const card = {
    border: "1px solid #ddd",
    borderRadius: 10,
    padding: 16,
    background: "#fff",
  };

  const input = {
    width: "100%",
    padding: 10,
    borderRadius: 8,
    border: "1px solid #ccc",
  };

  const btn = {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid #bbb",
    cursor: "pointer",
    background: "#f7f7f7",
  };

  const tableCell = {
    borderBottom: "1px solid #eee",
    padding: 10,
    verticalAlign: "top",
    whiteSpace: "nowrap",
  };

  // Highlight if above goal
  function isAboveGoal(key, totalValue) {
    const raw = goalsByKey[key];
    if (raw === "" || raw == null) return false;
    const goal = Number(raw);
    if (!Number.isFinite(goal)) return false;
    return totalValue > goal;
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, Arial", background: "#fafafa" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 10px 0" }}>Nutrition Platform</h1>

        <div style={{ marginBottom: 16, fontSize: 13, opacity: 0.85 }}>
          <div>Supabase URL present: {supabaseUrlPresent ? "Yes" : "No"}</div>
          <div>Anon key present: {supabaseAnonPresent ? "Yes" : "No"}</div>
        </div>

        {/* ADD FOOD */}
        <section style={{ ...card, marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 12px 0" }}>Add food</h2>

          {foodsLoading ? (
            <p>Loading foods…</p>
          ) : foodsError ? (
            <p style={{ color: "crimson" }}>Error loading foods: {foodsError}</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1.4fr 0.6fr 0.3fr",
                gap: 12,
                alignItems: "end",
              }}
            >
              <div>
                <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>
                  Search
                </label>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Type to filter foods…"
                  style={input}
                />
              </div>

              <div>
                <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>
                  Food
                </label>
                <select
                  value={selectedFoodId}
                  onChange={(e) => setSelectedFoodId(e.target.value)}
                  style={input}
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
                <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>
                  Grams
                </label>
                <input
                  type="number"
                  value={grams}
                  onChange={(e) => setGrams(e.target.value)}
                  min={1}
                  step={1}
                  style={input}
                />
              </div>

              <div>
                <button onClick={addEntry} style={{ ...btn, width: "100%" }}>
                  Add
                </button>
              </div>
            </div>
          )}
        </section>

        {/* SPREADSHEET TABLE */}
        <section style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <h2 style={{ margin: "0 0 12px 0" }}>Diet Spreadsheet</h2>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Formula: amount_per_100g × grams/100
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ ...tableCell, textAlign: "left" }}>Food</th>
                  <th style={{ ...tableCell, textAlign: "right" }}>Grams</th>
                  {visibleKeys.map((k) => {
                    const nid = nutrientIdByKey[k];
                    const meta = nid ? nutrientsById[nid] : null;
                    return (
                      <th key={k} style={{ ...tableCell, textAlign: "right" }}>
                        {meta?.name || k}
                        {meta?.unit ? <div style={{ fontSize: 11, opacity: 0.7 }}>{meta.unit}</div> : null}
                      </th>
                    );
                  })}
                  <th style={{ ...tableCell, textAlign: "left" }} />
                </tr>
              </thead>

              <tbody>
                {spreadsheetRows.length === 0 ? (
                  <tr>
                    <td colSpan={3 + visibleKeys.length} style={{ padding: 14, opacity: 0.75 }}>
                      No entries yet. Add a food + grams above.
                    </td>
                  </tr>
                ) : (
                  spreadsheetRows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ ...tableCell, textAlign: "left" }}>{row.name}</td>
                      <td style={{ ...tableCell, textAlign: "right" }}>
                        <input
                          type="number"
                          value={row.grams}
                          min={1}
                          step={1}
                          onChange={(e) => updateEntryGrams(row.id, e.target.value)}
                          style={{ width: 110, padding: 8, borderRadius: 8, border: "1px solid #ccc", textAlign: "right" }}
                        />
                     l哄
                      </td>
                      {visibleKeys.map((k) => (
                        <td key={k} style={{ ...tableCell, textAlign: "right" }}>
                          {round2(row.valuesByKey[k])}
                        </td>
                      ))}
                      <td style={{ ...tableCell, textAlign: "left" }}>
                        <button onClick={() => removeEntry(row.id)} style={{ ...btn, padding: "8px 10px" }}>
                          remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}

                {/* TOTALS ROW */}
                {spreadsheetRows.length > 0 ? (
                  <tr>
                    <td style={{ ...tableCell, fontWeight: 800 }}>TOTAL</td>
                    <td style={{ ...tableCell, textAlign: "right", fontWeight: 800 }}>
                      {round2(spreadsheetRows.reduce((sum, r) => sum + (r.grams || 0), 0))}
                    </td>
                    {visibleKeys.map((k) => {
                      const v = totalsByKey[k] || 0;
                      const warn = isAboveGoal(k, v);
                      return (
                        <td
                          key={k}
                          style={{
                            ...tableCell,
                            textAlign: "right",
                            fontWeight: 800,
                            background: warn ? "#ffe6e6" : "transparent",
                          }}
                          title={warn ? "Above goal" : ""}
                        >
                          {round2(v)}
                        </td>
                      );
                    })}
                    <td style={tableCell} />
                  </tr>
                ) : null}

                {/* GOALS ROW (editable) */}
                {spreadsheetRows.length > 0 ? (
                  <tr>
                    <td style={{ ...tableCell, fontWeight: 700, opacity: 0.9 }}>GOAL</td>
                    <td style={{ ...tableCell }} />
                    {visibleKeys.map((k) => (
                      <td key={k} style={{ ...tableCell, textAlign: "right" }}>
                        <input
                          value={goalsByKey[k] ?? ""}
                          onChange={(e) => updateGoal(k, e.target.value)}
                          placeholder="-"
                          style={{ width: 110, padding: 8, borderRadius: 8, border: "1px solid #ccc", textAlign: "right" }}
                        />
                      </td>
                    ))}
                    <td style={tableCell} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* Helpful hint */}
          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
            If totals are still empty: check that your table <b>food_nutrients_global</b> contains rows for the foods you selected and the nutrients you want.
          </div>
        </section>
      </div>
    </main>
  );
}

