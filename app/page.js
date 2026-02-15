"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * IMPORTANT:
 * This app assumes:
 * - foods_global(id, name, price_per_100g)
 * - food_nutrients_global(food_id, nutrient_id, amount_per_100g)
 * - nutrients(id, key, display_name, unit)
 *
 * We will build the spreadsheet columns using nutrients.key.
 */

// ✅ EDIT THIS LIST to match your spreadsheet columns (order matters).
// These keys must exist in nutrients.key.
const COLUMNS = [
  { key: "calories", label: "Kcal" },
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
  { key: "fiber", label: "Fiber" },
  { key: "sugar", label: "Sugar" },
  { key: "cholesterol", label: "Cholesterol" },
  { key: "omega_3", label: "Omega-3" },
  { key: "omega_6", label: "Omega-6" },
];

function round(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return 0;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

export default function Page() {
  // Foods
  const [foods, setFoods] = useState([]);
  const [foodsLoading, setFoodsLoading] = useState(true);
  const [foodsError, setFoodsError] = useState(null);

  // Nutrients meta
  const [nutrientIdByKey, setNutrientIdByKey] = useState({});
  const [nutrientMetaById, setNutrientMetaById] = useState({}); // id -> {key,name,unit}

  // food nutrients (for selected foods only)
  const [foodNutrients, setFoodNutrients] = useState([]);

  // Add UI
  const [query, setQuery] = useState("");
  const [selectedFoodId, setSelectedFoodId] = useState("");
  const [grams, setGrams] = useState(100);

  // Spreadsheet rows
  const [rows, setRows] = useState([]); // [{id, food_id, grams}]

  // Goals (per nutrient key)
  const [goals, setGoals] = useState(() => {
    const g = {};
    for (const c of COLUMNS) g[c.key] = "";
    return g;
  });

  // -----------------------------
  // Load foods
  // -----------------------------
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

  const foodById = useMemo(() => {
    const m = {};
    for (const f of foods) m[f.id] = f;
    return m;
  }, [foods]);

  // -----------------------------
  // Load nutrients meta (once)
  // -----------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("nutrients")
        .select("id,key,display_name,unit");

      if (cancelled) return;

      if (error) {
        console.error(error);
        setNutrientIdByKey({});
        setNutrientMetaById({});
        return;
      }

      const byKey = {};
      const byId = {};

      for (const n of data || []) {
        byKey[n.key] = n.id;
        byId[n.id] = {
          key: n.key,
          name: n.display_name || n.key,
          unit: n.unit || "",
        };
      }

      setNutrientIdByKey(byKey);
      setNutrientMetaById(byId);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // -----------------------------
  // Load nutrient rows for foods that are in the sheet
  // -----------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const foodIds = Array.from(new Set(rows.map((r) => r.food_id)));
      if (foodIds.length === 0) {
        setFoodNutrients([]);
        return;
      }

      const { data, error } = await supabase
        .from("food_nutrients_global")
        .select("food_id,nutrient_id,amount_per_100g")
        .in("food_id", foodIds);

      if (cancelled) return;

      if (error) {
        console.error(error);
        setFoodNutrients([]);
        return;
      }

      setFoodNutrients(data || []);
    })();

    return () => {
      cancelled = true;
    };
  }, [rows]);

  // Lookup: food_id -> nutrient_id -> amount_per_100g
  const amount100 = useMemo(() => {
    const m = {};
    for (const r of foodNutrients) {
      if (!m[r.food_id]) m[r.food_id] = {};
      m[r.food_id][r.nutrient_id] = Number(r.amount_per_100g || 0);
    }
    return m;
  }, [foodNutrients]);

  // Dropdown filtering
  const filteredFoods = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return foods.slice(0, 200);
    return foods
      .filter((f) => (f.name || "").toLowerCase().includes(q))
      .slice(0, 200);
  }, [foods, query]);

  // -----------------------------
  // Spreadsheet computed values
  // -----------------------------
  const computedRows = useMemo(() => {
    return rows.map((r) => {
      const food = foodById[r.food_id];
      const gramsNum = Number(r.grams || 0);

      const values = {};
      for (const c of COLUMNS) {
        const nid = nutrientIdByKey[c.key];
        const v100 = nid ? Number(amount100[r.food_id]?.[nid] || 0) : 0;
        values[c.key] = (v100 * gramsNum) / 100;
      }

      // omega ratio (if both present)
      const o3 = values["omega_3"] || 0;
      const o6 = values["omega_6"] || 0;
      const ratio = o3 > 0 ? o6 / o3 : null;

      return {
        ...r,
        foodName: food?.name || "Unknown food",
        price_per_100g: food?.price_per_100g ?? null,
        gramsNum,
        values,
        omegaRatio: ratio,
      };
    });
  }, [rows, foodById, nutrientIdByKey, amount100]);

  // Totals per nutrient
  const totals = useMemo(() => {
    const t = {};
    for (const c of COLUMNS) t[c.key] = 0;

    for (const r of computedRows) {
      for (const c of COLUMNS) t[c.key] += Number(r.values[c.key] || 0);
    }
    return t;
  }, [computedRows]);

  // Goal diff (total - goal)
  const diffs = useMemo(() => {
    const d = {};
    for (const c of COLUMNS) {
      const goal = Number(goals[c.key]);
      if (!Number.isFinite(goal)) {
        d[c.key] = null;
      } else {
        d[c.key] = totals[c.key] - goal;
      }
    }
    return d;
  }, [goals, totals]);

  // -----------------------------
  // Actions
  // -----------------------------
  function addFoodRow() {
    const g = Number(grams);
    if (!selectedFoodId) return;
    if (!Number.isFinite(g) || g <= 0) return;

    setRows((prev) => [
      ...prev,
      {
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : String(Date.now()) + Math.random(),
        food_id: selectedFoodId,
        grams: g,
      },
    ]);
  }

  function removeRow(id) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function updateRowGrams(id, value) {
    const g = Number(value);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, grams: g } : r)));
  }

  function updateGoal(key, value) {
    setGoals((prev) => ({ ...prev, [key]: value }));
  }

  // -----------------------------
  // Styles: spreadsheet feel
  // -----------------------------
  const box = {
    border: "1px solid #ddd",
    borderRadius: 10,
    background: "#fff",
  };

  const cell = {
    padding: "10px 10px",
    borderBottom: "1px solid #eee",
    borderRight: "1px solid #eee",
    textAlign: "right",
    whiteSpace: "nowrap",
  };

  const headCell = {
    ...cell,
    fontWeight: 800,
    background: "#f5f5f5",
    position: "sticky",
    top: 0,
    zIndex: 1,
  };

  const leftCell = { ...cell, textAlign: "left" };

  const inputSmall = {
    width: 90,
    padding: 6,
    borderRadius: 8,
    border: "1px solid #ccc",
    textAlign: "right",
  };

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, Arial", background: "#fafafa" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ margin: 0 }}>Nutrition Platform</h1>

        {/* ADD ROW (simple + aligned) */}
        <div style={{ ...box, padding: 16, marginTop: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 0.4fr 0.25fr", gap: 12, alignItems: "end" }}>
            <div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Search</div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type to filter foods…"
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
              />
            </div>

            <div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Food</div>
              {foodsLoading ? (
                <div>Loading…</div>
              ) : foodsError ? (
                <div style={{ color: "crimson" }}>{foodsError}</div>
              ) : (
                <select
                  value={selectedFoodId}
                  onChange={(e) => setSelectedFoodId(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                >
                  <option value="">Select…</option>
                  {filteredFoods.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                Showing {filteredFoods.length} foods (max 200)
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Grams</div>
              <input
                type="number"
                value={grams}
                onChange={(e) => setGrams(e.target.value)}
                min={1}
                step={1}
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
              />
            </div>

            <button
              onClick={addFoodRow}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #bbb", cursor: "pointer" }}
            >
              Add
            </button>
          </div>
        </div>

        {/* SPREADSHEET */}
        <div style={{ ...box, marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 1000 }}>
            <thead>
              <tr>
                <th style={{ ...headCell, textAlign: "left" }}>Food</th>
                <th style={headCell}>g</th>
                {COLUMNS.map((c) => {
                  const id = nutrientIdByKey[c.key];
                  const meta = id ? nutrientMetaById[id] : null;
                  const unit = meta?.unit ? ` (${meta.unit})` : "";
                  return (
                    <th key={c.key} style={headCell}>
                      {c.label}{unit}
                    </th>
                  );
                })}
                <th style={headCell}>Ω6/Ω3</th>
                <th style={{ ...headCell, borderRight: "none" }} />
              </tr>
            </thead>

            <tbody>
              {computedRows.length === 0 ? (
                <tr>
                  <td style={{ ...leftCell, borderRight: "none" }} colSpan={COLUMNS.length + 4}>
                    Add foods to start (like your spreadsheet).
                  </td>
                </tr>
              ) : (
                computedRows.map((r) => (
                  <tr key={r.id}>
                    <td style={leftCell}>{r.foodName}</td>

                    <td style={cell}>
                      <input
                        type="number"
                        value={r.gramsNum}
                        onChange={(e) => updateRowGrams(r.id, e.target.value)}
                        style={inputSmall}
                      />
                    </td>

                    {COLUMNS.map((c) => (
                      <td key={c.key} style={cell}>
                        {round(r.values[c.key])}
                      </td>
                    ))}

                    <td style={cell}>
                      {r.omegaRatio == null ? "-" : round(r.omegaRatio, 3)}
                    </td>

                    <td style={{ ...cell, borderRight: "none", textAlign: "left" }}>
                      <button
                        onClick={() => removeRow(r.id)}
                        style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #bbb", cursor: "pointer" }}
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                ))
              )}

              {/* TOTALS row: ✅ nutrition totals ONLY */}
              {computedRows.length > 0 ? (
                <tr>
                  <td style={{ ...leftCell, fontWeight: 900 }}>TOTAL</td>
                  <td style={{ ...cell, fontWeight: 900 }}>{/* keep grams empty or show g total if YOU want */}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} style={{ ...cell, fontWeight: 900 }}>
                      {round(totals[c.key])}
                    </td>
                  ))}
                  <td style={{ ...cell, fontWeight: 900 }}>—</td>
                  <td style={{ ...cell, borderRight: "none" }} />
                </tr>
              ) : null}

              {/* GOAL row */}
              {computedRows.length > 0 ? (
                <tr>
                  <td style={{ ...leftCell, fontWeight: 800, opacity: 0.85 }}>GOAL</td>
                  <td style={cell} />
                  {COLUMNS.map((c) => (
                    <td key={c.key} style={cell}>
                      <input
                        value={goals[c.key]}
                        onChange={(e) => updateGoal(c.key, e.target.value)}
                        placeholder="-"
                        style={inputSmall}
                      />
                    </td>
                  ))}
                  <td style={cell} />
                  <td style={{ ...cell, borderRight: "none" }} />
                </tr>
              ) : null}

              {/* DIFF row */}
              {computedRows.length > 0 ? (
                <tr>
                  <td style={{ ...leftCell, fontWeight: 800, opacity: 0.85 }}>TOTAL − GOAL</td>
                  <td style={cell} />
                  {COLUMNS.map((c) => {
                    const d = diffs[c.key];
                    const isNumber = d != null;
                    const over = isNumber && d > 0;
                    return (
                      <td
                        key={c.key}
                        style={{
                          ...cell,
                          fontWeight: 800,
                          background: over ? "#ffe6e6" : "transparent",
                        }}
                      >
                        {isNumber ? round(d) : "-"}
                      </td>
                    );
                  })}
                  <td style={cell} />
                  <td style={{ ...cell, borderRight: "none" }} />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Debug hints */}
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>
          If some columns show 0 for every food: your nutrients.key names in Supabase might not match the keys in COLUMNS above.
        </div>
      </div>
    </main>
  );
}
