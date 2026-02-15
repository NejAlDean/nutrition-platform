"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * EXPECTED SUPABASE TABLES
 * - foods_global: id, name, price_per_100g (price optional)
 * - nutrients: id, key, display_name, unit, info_text, default_goal, default_max (some optional)
 * - food_nutrients_global: food_id, nutrient_id, amount_per_100g
 *
 * If your nutrients table doesn't have default_goal/default_max/info_text, the UI still works,
 * those fields will just show empty.
 */

// Prefer showing these nutrients first (you can change to match your sheet)
const PREFERRED_KEYS = [
  "calories",
  "energy_kcal",
  "protein",
  "fat",
  "total_fat",
  "carbs",
  "fiber",
  "sugar",
  "cholesterol",
  "omega_3",
  "omega_6",
  "sodium",
  "potassium",
  "vitamin_c",
  "vitamin_a",
  "magnesium",
  "iron",
  "b12",
  "folate",
];

const LS_KEY = "nutrition_targets_v1";

function round(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return 0;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export default function Page() {
  // Foods list (searches server-side to keep fast)
  const [foodQuery, setFoodQuery] = useState("");
  const [foods, setFoods] = useState([]);
  const [foodsLoading, setFoodsLoading] = useState(false);
  const [foodsError, setFoodsError] = useState("");

  // Nutrients meta
  const [nutrients, setNutrients] = useState([]);
  const [nutrientsLoading, setNutrientsLoading] = useState(true);
  const [nutrientsError, setNutrientsError] = useState("");

  // Selected diet rows
  // { id, food_id, name, grams }
  const [dietRows, setDietRows] = useState([]);

  // Targets (goals + max) per nutrient_id (editable)
  // { [nutrient_id]: { goal: number|null, max: number|null } }
  const [targets, setTargets] = useState({});

  // Columns shown (nutrient_ids)
  const [shownNutrientIds, setShownNutrientIds] = useState([]);

  // Food nutrients rows
  const [foodNutrientsRows, setFoodNutrientsRows] = useState([]);
  const [foodNutrientsLoading, setFoodNutrientsLoading] = useState(false);
  const [foodNutrientsError, setFoodNutrientsError] = useState("");

  // Add food UI
  const [selectedFoodId, setSelectedFoodId] = useState("");
  const [gramsToAdd, setGramsToAdd] = useState(100);

  // Info modal
  const [infoModal, setInfoModal] = useState({ open: false, nutrient: null });

  // --- Load nutrients (once)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setNutrientsLoading(true);
      setNutrientsError("");

      const { data, error } = await supabase
        .from("nutrients")
        .select("id,key,display_name,unit,info_text,default_goal,default_max")
        .order("display_name", { ascending: true });

      if (cancelled) return;

      if (error) {
        setNutrientsError(error.message || String(error));
        setNutrients([]);
        setNutrientsLoading(false);
        return;
      }

      const list = data || [];
      setNutrients(list);
      setNutrientsLoading(false);

      // Determine default shown columns:
      // 1) preferred keys that exist
      // 2) if none match, first 10 nutrients
      const idByKey = new Map(list.map((n) => [n.key, n.id]));
      const preferredIds = [];
      for (const k of PREFERRED_KEYS) {
        const id = idByKey.get(k);
        if (id) preferredIds.push(id);
      }
      const fallback = list.slice(0, 10).map((n) => n.id);
      const initialShown = (preferredIds.length ? preferredIds : fallback).slice(0, 12);
      setShownNutrientIds(initialShown);

      // Load targets from localStorage, otherwise seed from defaults
      let fromLS = null;
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) fromLS = JSON.parse(raw);
      } catch {}

      if (fromLS && typeof fromLS === "object") {
        setTargets(fromLS);
      } else {
        const seeded = {};
        for (const n of list) {
          seeded[n.id] = {
            goal: safeNum(n.default_goal),
            max: safeNum(n.default_max),
          };
        }
        setTargets(seeded);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist targets to localStorage (so it behaves like spreadsheet edits)
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(targets));
    } catch {}
  }, [targets]);

  // --- Foods search (server-side)
  const searchTimer = useRef(null);
  useEffect(() => {
    let cancelled = false;

    // Debounce typing
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setFoodsLoading(true);
      setFoodsError("");

      let q = supabase
        .from("foods_global")
        .select("id,name,price_per_100g")
        .order("name", { ascending: true })
        .limit(50);

      if (foodQuery.trim()) {
        q = q.ilike("name", `%${foodQuery.trim()}%`);
      }

      const { data, error } = await q;

      if (cancelled) return;

      if (error) {
        setFoodsError(error.message || String(error));
        setFoods([]);
      } else {
        setFoods(data || []);
      }
      setFoodsLoading(false);
    }, 250);

    return () => {
      cancelled = true;
    };
  }, [foodQuery]);

  // --- Fetch nutrient amounts for selected foods + shown nutrients
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const foodIds = Array.from(new Set(dietRows.map((r) => r.food_id)));
      const nutrientIds = shownNutrientIds;

      if (!foodIds.length || !nutrientIds.length) {
        setFoodNutrientsRows([]);
        return;
      }

      setFoodNutrientsLoading(true);
      setFoodNutrientsError("");

      const { data, error } = await supabase
        .from("food_nutrients_global")
        .select("food_id,nutrient_id,amount_per_100g")
        .in("food_id", foodIds)
        .in("nutrient_id", nutrientIds);

      if (cancelled) return;

      if (error) {
        setFoodNutrientsError(error.message || String(error));
        setFoodNutrientsRows([]);
      } else {
        setFoodNutrientsRows(data || []);
      }

      setFoodNutrientsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [dietRows, shownNutrientIds]);

  // --- Lookups
  const nutrientById = useMemo(() => {
    const m = new Map();
    for (const n of nutrients) m.set(n.id, n);
    return m;
  }, [nutrients]);

  const amount100ByFoodAndNutrient = useMemo(() => {
    // food_id -> nutrient_id -> amount_per_100g
    const m = new Map();
    for (const r of foodNutrientsRows) {
      if (!m.has(r.food_id)) m.set(r.food_id, new Map());
      m.get(r.food_id).set(r.nutrient_id, Number(r.amount_per_100g) || 0);
    }
    return m;
  }, [foodNutrientsRows]);

  // --- Spreadsheet cells: per row, per nutrient
  const computedDietRows = useMemo(() => {
    return dietRows.map((row) => {
      const grams = Number(row.grams) || 0;
      const foodMap = amount100ByFoodAndNutrient.get(row.food_id);

      const values = {};
      for (const nid of shownNutrientIds) {
        const per100 = foodMap?.get(nid) ?? 0;
        values[nid] = (per100 * grams) / 100;
      }

      return { ...row, grams, values };
    });
  }, [dietRows, amount100ByFoodAndNutrient, shownNutrientIds]);

  // --- Totals per nutrient column
  const totalsByNutrientId = useMemo(() => {
    const totals = {};
    for (const nid of shownNutrientIds) totals[nid] = 0;

    for (const row of computedDietRows) {
      for (const nid of shownNutrientIds) {
        totals[nid] += Number(row.values[nid] || 0);
      }
    }

    return totals;
  }, [computedDietRows, shownNutrientIds]);

  // --- Actions
  function addFoodToDiet() {
    const g = Number(gramsToAdd);
    if (!selectedFoodId) return;
    if (!Number.isFinite(g) || g <= 0) return;

    const food = foods.find((f) => String(f.id) === String(selectedFoodId));
    const name = food?.name || "Unknown food";

    setDietRows((prev) => [
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

    setSelectedFoodId("");
    setGramsToAdd(100);
  }

  function removeDietRow(rowId) {
    setDietRows((prev) => prev.filter((r) => r.id !== rowId));
  }

  function updateDietRowGrams(rowId, grams) {
    const g = Number(grams);
    setDietRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, grams: g } : r))
    );
  }

  function setTarget(nutrientId, field, value) {
    const n = safeNum(value);
    setTargets((prev) => ({
      ...prev,
      [nutrientId]: {
        goal: prev?.[nutrientId]?.goal ?? null,
        max: prev?.[nutrientId]?.max ?? null,
        [field]: n,
      },
    }));
  }

  function resetTargetsToDefaults() {
    const seeded = {};
    for (const n of nutrients) {
      seeded[n.id] = {
        goal: safeNum(n.default_goal),
        max: safeNum(n.default_max),
      };
    }
    setTargets(seeded);
  }

  function toggleColumn(nutrientId) {
    setShownNutrientIds((prev) =>
      prev.includes(nutrientId)
        ? prev.filter((x) => x !== nutrientId)
        : [...prev, nutrientId]
    );
  }

  function openInfo(nutrientId) {
    setInfoModal({ open: true, nutrient: nutrientById.get(nutrientId) || null });
  }

  // --- Professional UI helpers (color rules)
  function exceedsMax(nutrientId) {
    const max = targets?.[nutrientId]?.max;
    if (max == null) return false;
    return (totalsByNutrientId[nutrientId] || 0) > max;
  }

  // --- Render
  return (
    <main className="wrap">
      <header className="header">
        <div>
          <h1 className="title">Diet Builder</h1>
          <div className="subtitle">
            Spreadsheet-style diet sheet: foods → grams → totals vs goals/max.
          </div>
        </div>

        <button className="btn ghost" onClick={resetTargetsToDefaults}>
          Reset goals/max to defaults
        </button>
      </header>

      {/* Add food */}
      <section className="card">
        <div className="cardTitle">Add food</div>

        <div className="gridAdd">
          <div>
            <label className="label">Search foods</label>
            <input
              className="input"
              value={foodQuery}
              onChange={(e) => setFoodQuery(e.target.value)}
              placeholder="Type food name…"
            />
            <div className="hint">
              {foodsLoading ? "Searching…" : foodsError ? foodsError : `Showing ${foods.length} foods`}
            </div>
          </div>

          <div>
            <label className="label">Food</label>
            <select
              className="input"
              value={selectedFoodId}
              onChange={(e) => setSelectedFoodId(e.target.value)}
            >
              <option value="">Select…</option>
              {foods.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Grams</label>
            <input
              className="input"
              type="number"
              min="1"
              step="1"
              value={gramsToAdd}
              onChange={(e) => setGramsToAdd(e.target.value)}
            />
          </div>

          <div className="addBtnWrap">
            <button className="btn" onClick={addFoodToDiet}>
              Add
            </button>
          </div>
        </div>
      </section>

      {/* Column chooser */}
      <section className="card">
        <div className="cardTitle">Columns</div>

        {nutrientsLoading ? (
          <div className="hint">Loading nutrients…</div>
        ) : nutrientsError ? (
          <div className="error">{nutrientsError}</div>
        ) : (
          <div className="pillWrap">
            {nutrients.map((n) => (
              <button
                key={n.id}
                className={`pill ${shownNutrientIds.includes(n.id) ? "pillOn" : ""}`}
                onClick={() => toggleColumn(n.id)}
                title="Show/hide column"
              >
                {n.display_name || n.key}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Diet sheet */}
      <section className="card">
        <div className="cardTitleRow">
          <div className="cardTitle">Diet sheet</div>
          <div className="hint">
            {foodNutrientsLoading ? "Loading nutrient values…" : foodNutrientsError ? foodNutrientsError : ""}
          </div>
        </div>

        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th className="th left">Food</th>
                <th className="th right">g</th>

                {shownNutrientIds.map((nid) => {
                  const n = nutrientById.get(nid);
                  const label = n?.display_name || n?.key || nid;
                  const unit = n?.unit ? ` (${n.unit})` : "";
                  return (
                    <th key={nid} className="th right">
                      <div className="thFlex">
                        <span>{label}{unit}</span>
                        <button className="iconBtn" onClick={() => openInfo(nid)} title="Info">
                          i
                        </button>
                      </div>
                    </th>
                  );
                })}

                <th className="th center"> </th>
              </tr>
            </thead>

            <tbody>
              {computedDietRows.length === 0 ? (
                <tr>
                  <td className="td left" colSpan={shownNutrientIds.length + 3}>
                    Add foods above to start building your diet.
                  </td>
                </tr>
              ) : (
                computedDietRows.map((row) => (
                  <tr key={row.id}>
                    <td className="td left">{row.name}</td>

                    <td className="td right">
                      <input
                        className="cellInput"
                        type="number"
                        min="1"
                        step="1"
                        value={row.grams}
                        onChange={(e) => updateDietRowGrams(row.id, e.target.value)}
                      />
                    </td>

                    {shownNutrientIds.map((nid) => (
                      <td key={nid} className="td right">
                        {round(row.values[nid])}
                      </td>
                    ))}

                    <td className="td center">
                      <button className="btn tiny ghost" onClick={() => removeDietRow(row.id)}>
                        remove
                      </button>
                    </td>
                  </tr>
                ))
              )}

              {/* TOTALS row (nutrients totals) */}
              {computedDietRows.length > 0 ? (
                <tr>
                  <td className="td left totalLabel">TOTALS</td>
                  <td className="td right totalCell"> </td>
                  {shownNutrientIds.map((nid) => (
                    <td
                      key={nid}
                      className={`td right totalCell ${exceedsMax(nid) ? "warn" : ""}`}
                      title={exceedsMax(nid) ? "Exceeded max" : ""}
                    >
                      {round(totalsByNutrientId[nid])}
                    </td>
                  ))}
                  <td className="td center totalCell"> </td>
                </tr>
              ) : null}

              {/* GOALS row (editable) */}
              {computedDietRows.length > 0 ? (
                <tr>
                  <td className="td left dimLabel">GOAL</td>
                  <td className="td right dimCell"> </td>
                  {shownNutrientIds.map((nid) => (
                    <td key={nid} className="td right dimCell">
                      <input
                        className="cellInput"
                        placeholder="-"
                        value={targets?.[nid]?.goal ?? ""}
                        onChange={(e) => setTarget(nid, "goal", e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="td center dimCell"> </td>
                </tr>
              ) : null}

              {/* MAX row (editable) */}
              {computedDietRows.length > 0 ? (
                <tr>
                  <td className="td left dimLabel">MAX</td>
                  <td className="td right dimCell"> </td>
                  {shownNutrientIds.map((nid) => (
                    <td key={nid} className="td right dimCell">
                      <input
                        className="cellInput"
                        placeholder="-"
                        value={targets?.[nid]?.max ?? ""}
                        onChange={(e) => setTarget(nid, "max", e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="td center dimCell"> </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Info modal */}
      {infoModal.open && (
        <div className="modalBackdrop" onClick={() => setInfoModal({ open: false, nutrient: null })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">
              {infoModal.nutrient?.display_name || infoModal.nutrient?.key || "Nutrient"}
            </div>
            <div className="modalBody">
              <div className="modalRow">
                <span className="muted">Unit:</span>{" "}
                {infoModal.nutrient?.unit || "-"}
              </div>
              <div className="modalRow">
                <span className="muted">Info:</span>{" "}
                {infoModal.nutrient?.info_text || "No info text yet."}
              </div>
              <div className="modalRow">
                <span className="muted">Default goal:</span>{" "}
                {infoModal.nutrient?.default_goal ?? "-"}
              </div>
              <div className="modalRow">
                <span className="muted">Default max:</span>{" "}
                {infoModal.nutrient?.default_max ?? "-"}
              </div>
            </div>
            <div className="modalActions">
              <button className="btn" onClick={() => setInfoModal({ open: false, nutrient: null })}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .wrap {
          padding: 24px;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
          background: #f7f7fb;
          min-height: 100vh;
        }
        .header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          max-width: 1200px;
          margin: 0 auto 16px auto;
        }
        .title {
          margin: 0;
          font-size: 26px;
          letter-spacing: -0.2px;
        }
        .subtitle {
          margin-top: 6px;
          color: #666;
          font-size: 13px;
        }
        .card {
          max-width: 1200px;
          margin: 0 auto 12px auto;
          background: white;
          border: 1px solid #e6e6ef;
          border-radius: 14px;
          padding: 14px;
          box-shadow: 0 6px 24px rgba(0,0,0,0.04);
        }
        .cardTitle {
          font-weight: 800;
          margin-bottom: 10px;
        }
        .cardTitleRow {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          margin-bottom: 10px;
        }
        .label {
          display: block;
          font-size: 12px;
          font-weight: 700;
          margin-bottom: 6px;
          color: #333;
        }
        .input {
          width: 100%;
          padding: 10px;
          border-radius: 10px;
          border: 1px solid #d6d6e6;
          outline: none;
        }
        .hint {
          font-size: 12px;
          color: #777;
          margin-top: 6px;
        }
        .error {
          color: #b00020;
          font-size: 13px;
        }
        .gridAdd {
          display: grid;
          grid-template-columns: 1.3fr 1.2fr 0.5fr 0.3fr;
          gap: 12px;
          align-items: end;
        }
        .addBtnWrap {
          display: flex;
          justify-content: flex-end;
        }
        .btn {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #d6d6e6;
          background: #111827;
          color: white;
          cursor: pointer;
          font-weight: 700;
        }
        .btn.ghost {
          background: white;
          color: #111827;
        }
        .btn.tiny {
          padding: 6px 10px;
          border-radius: 10px;
          font-weight: 700;
        }
        .pillWrap {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .pill {
          border: 1px solid #d6d6e6;
          background: white;
          border-radius: 999px;
          padding: 7px 10px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 700;
        }
        .pillOn {
          background: #111827;
          color: white;
          border-color: #111827;
        }
        .tableWrap {
          overflow-x: auto;
          border: 1px solid #eee;
          border-radius: 12px;
        }
        .table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          min-width: 900px;
        }
        .th, .td {
          padding: 10px 10px;
          border-bottom: 1px solid #eee;
          border-right: 1px solid #f0f0f0;
          white-space: nowrap;
        }
        .th {
          background: #fafafa;
          font-size: 12px;
          font-weight: 900;
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .left { text-align: left; }
        .right { text-align: right; }
        .center { text-align: center; }
        .thFlex {
          display: inline-flex;
          gap: 8px;
          align-items: center;
          justify-content: flex-end;
        }
        .iconBtn {
          width: 22px;
          height: 22px;
          border-radius: 999px;
          border: 1px solid #d6d6e6;
          background: white;
          cursor: pointer;
          font-weight: 900;
          line-height: 1;
        }
        .cellInput {
          width: 92px;
          padding: 7px 8px;
          border-radius: 10px;
          border: 1px solid #d6d6e6;
          text-align: right;
        }
        .totalLabel {
          font-weight: 900;
        }
        .totalCell {
          font-weight: 900;
          background: #fbfbff;
        }
        .dimLabel {
          font-weight: 900;
          color: #444;
        }
        .dimCell {
          background: #fcfcfc;
        }
        .warn {
          background: #ffe9e9 !important;
          color: #9b0000;
        }
        .modalBackdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
        }
        .modal {
          background: white;
          width: 520px;
          max-width: 100%;
          border-radius: 14px;
          border: 1px solid #e6e6ef;
          box-shadow: 0 20px 60px rgba(0,0,0,0.25);
          padding: 14px;
        }
        .modalTitle {
          font-weight: 900;
          font-size: 16px;
          margin-bottom: 10px;
        }
        .modalBody {
          font-size: 13px;
          color: #222;
          line-height: 1.5;
        }
        .modalRow {
          margin-bottom: 8px;
        }
        .muted {
          color: #666;
          font-weight: 800;
        }
        .modalActions {
          display: flex;
          justify-content: flex-end;
          margin-top: 10px;
        }
        @media (max-width: 900px) {
          .gridAdd {
            grid-template-columns: 1fr;
          }
          .addBtnWrap {
            justify-content: stretch;
          }
          .btn {
            width: 100%;
          }
        }
      `}</style>
    </main>
  );
}
