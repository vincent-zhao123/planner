import React, { useMemo, useState } from "react";
import "./App.css";

/**
 * Retirement Planner 
 */

const PLAN_MODES = {
  STANDARD: "standard",          // Years + Expenses
  FIND_MAX_YEARS: "findMaxYears",// no Years input
  SOLVE_EXPENSES: "solveExpenses"// no Expenses input
};

async function downloadExcel(payload) {
  console.log("downloadExcel called with:", payload);

  let res;
  try {
    res = await fetch(
      "https://planner-2juz.onrender.com/api/generate-excel",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  } catch (err) {
    console.error("FETCH FAILED:", err);
    alert("Fetch failed. Backend not reachable.");
    throw err;
  }

  console.log("Excel response:", res.status, res.headers.get("content-type"));
  const blob = await res.blob();
  console.log("Blob size:", blob.size);

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "retirement_inputs.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}


export default function App() {
  const schema = useMemo(
    () => [
      {
        section: "CURRENT AGE, YEARS TO RETIRE, YEARS TO PLAN",
        fields: [
          {
            key: "currentAge",
            label: "Current Age",
            type: "number",
            unit: "years",
            min: 0,
            max: 100,
            required: true,
          },
          {
            key: "yearsToRetire",
            label: "Years to Retire",
            type: "number",
            unit: "years",
            min: 0,
            max: 100,
            required: true,
          },
          {
            key: "yearsToPlan",
            label: "Years to Plan (Retirement Duration)",
            type: "number",
            unit: "years",
            min: 0,
            max: 100,
            required: true,
          },
        ],
      },

      {
        section: "RRSP ROI, RRSP INITIAL BALANCE, RRSP CONTRIBUTE",
        fields: [
          {
            key: "rrspRoi",
            label: "RRSP ROI",
            type: "number",
            unit: "percent",
            min: 0,
            max: 100,
            required: true,
            hint: "Return on investment (e.g., 6 = 6%)",
          },
          {
            key: "rrspInitialBalance",
            label: "RRSP Initial Balance",
            type: "number",
            unit: "currency",
            currency: "CAD",
            min: 0,
            required: true,
          },
          {
            key: "rrspContribute",
            label: "RRSP Contribution (Annual)",
            type: "number",
            unit: "currency",
            currency: "CAD",
            min: 0,
            max: 32000,
            required: false,
          },
        ],
      },

      {
        section: "TFSA ROI, TFSA INITIAL BALANCE, TFSA CONTRIBUTE",
        fields: [
          {
            key: "tfsaRoi",
            label: "TFSA ROI",
            type: "number",
            unit: "percent",
            min: 0,
            max: 100,
            required: true,
            hint: "Return on investment (e.g., 6 = 6%)",
          },
          {
            key: "tfsaInitialBalance",
            label: "TFSA Initial Balance",
            type: "number",
            unit: "currency",
            currency: "CAD",
            min: 0,
            required: true,
          },
          {
            key: "tfsaContribute",
            label: "TFSA Contribution (Annual)",
            type: "number",
            unit: "currency",
            currency: "CAD",
            default: 7000,
            min: 0,
            max: 7000,
            required: true,
          },
        ],
      },

      {
        section: "NON-R ROI, NON-R INITIAL BALANCE",
        fields: [
          {
            key: "nonRegisteredRoi",
            label: "Non-Registered ROI",
            type: "number",
            unit: "percent",
            min: 0,
            max: 100,
            required: true,
            hint: "Return on investment (e.g., 6 = 6%)",
          },
          {
            key: "nonRegisteredInitialBalance",
            label: "Non-Registered Initial Balance",
            type: "number",
            unit: "currency",
            currency: "CAD",
            min: 0,
            required: true,
          },
        ],
      },

      {
        section: "INCOME",
        fields: [
          {
            key: "incomeAnnual",
            label: "Income (Annual)",
            type: "number",
            unit: "currency",
            currency: "CAD",
            min: 0,
            required: true,
          },
        ],
      },

      {
        section: "EXPENSES, INFLATION RATE",
        fields: [
          {
            key: "expensesAnnual",
            label: "Expenses (Annual)",
            type: "number",
            unit: "currency",
            currency: "CAD",
            min: 0,
            required: true,
          },
          {
            key: "inflationRate",
            label: "Inflation Rate",
            type: "number",
            unit: "percent",
            min: 0,
            max: 100,
            required: true,
            hint: "Annual inflation assumption (e.g., 2.5 = 2.5%)",
          },
        ],
      },
    ],
    []
  );

  const visibleSchema = useMemo(() => {
    return schema.map((group) => ({
      ...group,
      fields: group.fields.filter((field) => {
        if (mode === PLAN_MODES.FIND_MAX_YEARS && field.key === "yearsToPlan") return false;
        if (mode === PLAN_MODES.SOLVE_EXPENSES && field.key === "expensesAnnual") return false;
        return true;
      }),
    }));
  }, [schema, mode]);

  const initialValues = useMemo(() => {
    const v = {};
    for (const group of schema) {
      for (const f of group.fields) v[f.key] = f.default ?? "";
    }
    return v;
  }, [schema]);
  
  const [mode, setMode] = useState(PLAN_MODES.STANDARD);

  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [rrspAuto, setRrspAuto] = useState(false);

  const [rrspContributeAuto] = useState(false);

  function formatUnit(field) {
    if (field.unit === "percent") return "%";
    if (field.unit === "years") return "years";
    if (field.unit === "currency") return field.currency || "CAD";
    return "";
  }

  function validateOne(field, rawValue, ctx = {}) {
    if (field.key === "rrspContribute" && !!ctx.rrspContributeAuto) return null;

    const valStr = String(rawValue ?? "").trim();
    const isEmpty = valStr === "";

    if (field.required && isEmpty) return "Required";

    // If not required and empty, it's valid
    if (!field.required && isEmpty) return null;

    // All fields here are number inputs
    const num = Number(valStr);
    if (Number.isNaN(num)) return "Must be a number";

    if (typeof field.min === "number" && num < field.min)
      return `Must be ≥ ${field.min}`;
    if (typeof field.max === "number" && num > field.max)
      return `Must be ≤ ${field.max}`;

    return null;
  }

  function validateAll(nextValues, ctx) {
    const nextErrors = {};
    for (const group of schema) {
      for (const field of group.fields) {
        const err = validateOne(field, nextValues[field.key], ctx);
        if (err) nextErrors[field.key] = err;
      }
    }
    return nextErrors;
  }

  function handleChange(field, e) {
    const next = { ...values, [field.key]: e.target.value };
    setValues(next);

    // live-validate this field
    const ctx = { rrspContributeAuto };
    const err = validateOne(field, next[field.key], ctx);
    setErrors((prev) => {
      const copy = { ...prev };
      if (err) copy[field.key] = err;
      else delete copy[field.key];
      return copy;
    });
  }

  /*function handleToggleRrspAuto(e) {
    const checked = e.target.checked;
    setRrspContributeAuto(checked);

    setValues((prev) => {
      const next = { ...prev };
      if (checked) next.rrspContribute = 18;
      return next;
    });

    setErrors((prev) => {
      const copy = { ...prev };
      if (checked) delete copy.rrspContribute;
      return copy;
    });
  }*/

  function handleReset() {
    setValues(initialValues);
    setErrors({});
  }

  const toNum = (v) => {
    if (v === null || v === undefined) return 0;
    const s = String(v).trim();
    if (s === "") return 0;
  
    // remove $ , spaces etc (keep digits, dot, minus)
    const cleaned = s.replace(/[^\d.-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  };
  
  const calcRrsp18 = (incomeAnnual) => {
    return Math.round(toNum(incomeAnnual) * 0.18); // round dollars (change if you want cents)
  };

  const handleRrspAutoToggle = (checked) => {
    setRrspAuto(checked);
  
    if (checked) {
      const autoValue = calcRrsp18(values.incomeAnnual);
      setValues((prev) => ({
        ...prev,
        rrspContribute: String(autoValue),
      }));
    }
  };

  /*const handleIncomeChange = (val) => {
    setValues((prev) => {
      const next = { ...prev, incomeAnnual: val };
  
      if (rrspAuto) {
        next.rrspContribute = String(calcRrsp18(val));
      }
  
      return next;
    });
  };*/

  async function handleSubmit(e) {
    console.log("Submit clicked")

    e.preventDefault();
    //await downloadExcel(numericPayload);

    const ctx = { rrspContributeAuto };
    const nextErrors = validateAll(values, ctx);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    // Convert to numbers so backend gets numeric types
    const numericPayload = {};
    for (const group of schema) {
      for (const f of group.fields) {
        const raw = values[f.key];
        numericPayload[f.key] = raw === "" ? "" : Number(raw);
      }
    }
    console.log("Payload:", numericPayload);
    console.log("About to download...");

    /*const income = toNum(numericPayload.incomeAnnual);
    const expenses = toNum(numericPayload.expensesAnnual);

    const rrsp = rrspContributeAuto ? 18 : toNum(numericPayload.rrspContribute);
    const tfsa = toNum(numericPayload.tfsaContribute);

    const totalOut = expenses + rrsp + tfsa;

    if (totalOut > income) {
      alert(
        `❌ Submission Error\n\n` +
        `Income: $${income}\n` +
        `Expenses: $${expenses}\n` +
        `RRSP: $${rrsp}\n` +
        `TFSA: $${tfsa}\n` +
        `----------------------\n` +
        `Total: $${totalOut}\n\n` +
        `Reason: expenses + RRSP + TFSA must be ≤ income.`
      );
      return;
    }*/

    try {
      await downloadExcel(numericPayload);
      console.log("Download finished (request completed).");
    } catch (err) {
      console.error("Download failed:", err);
      alert("Download failed. Check Console + Network.");
    }
  }

  // Simple inline styling (so you don't need to touch App.css)
  const styles = {
    page: {
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      padding: 20,
      maxWidth: 900,
      margin: "0 auto",
    },
    header: { marginBottom: 16 },
    card: {
      border: "1px solid #e6e6e6",
      borderRadius: 12,
      padding: 16,
      marginBottom: 14,
      background: "white",
    },
    sectionTitle: {
      fontWeight: 700,
      fontSize: 14,
      letterSpacing: 0.3,
      marginBottom: 12,
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
      gap: 12,
    },
    field: { display: "flex", flexDirection: "column", gap: 6 },
    labelRow: { display: "flex", justifyContent: "space-between", gap: 10 },
    label: { fontWeight: 600, fontSize: 13 },
    hint: { fontSize: 12, color: "#666" },
    input: {
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid #d9d9d9",
      outline: "none",
      fontSize: 14,
    },
    inputError: {
      border: "1px solid #d93025",
    },
    errorText: { color: "#d93025", fontSize: 12 },
    unit: { fontSize: 12, color: "#666", whiteSpace: "nowrap" },
    actions: { display: "flex", gap: 10, marginTop: 10 },
    btn: {
      padding: "10px 14px",
      borderRadius: 10,
      border: "1px solid #d9d9d9",
      background: "#f7f7f7",
      cursor: "pointer",
      fontWeight: 600,
    },
    btnPrimary: {
      background: "#111",
      color: "white",
      border: "1px solid #111",
    },
    output: {
      marginTop: 16,
      padding: 14,
      borderRadius: 12,
      background: "#0b1020",
      color: "white",
      overflowX: "auto",
      fontSize: 13,
      lineHeight: 1.4,
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={{ margin: 0 }}>Retirement Plan Input Form</h2>

        <p style={{ margin: "6px 0 12px", color: "#555" }}>
          Fill in the inputs below, then submit to view the plan result.
        </p>

        {/* Mode selector */}
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="mode"
              checked={mode === "standard"}
              onChange={() => setMode("standard")}
            />
            Standard Plan
          </label>

          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="mode"
              checked={mode === "findMaxYears"}
              onChange={() => setMode("findMaxYears")}
            />
            Find Max Years
          </label>

          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="mode"
              checked={mode === "solveExpenses"}
              onChange={() => setMode("solveExpenses")}
            />
            Solve Expenses
          </label>
        </div>
      </div>


      <form onSubmit={handleSubmit}>
        {visibleSchema.map((group) => (
          <div key={group.section} style={styles.card}>
            <div style={styles.sectionTitle}>{group.section}</div>

            <div style={styles.grid}>
              {group.fields.map((field) => {
                const unit = formatUnit(field);
                const err = errors[field.key];

                const isRrspContribute = field.key === "rrspContribute";
                const disabled = isRrspContribute && rrspContributeAuto;

                const inputStyle = err
                  ? { ...styles.input, ...styles.inputError }
                  : styles.input;

                return (
                  <div key={field.key} style={styles.field}>
                    <div style={styles.labelRow}>
                      <div style={styles.label}>
                        {field.label} {field.required ? "*" : ""}
                      </div>
                      <div style={styles.unit}>{unit}</div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input
                        style={{
                          ...inputStyle,
                          flex: 1,
                        }}
                        type="number"
                        value={values[field.key]}
                        min={field.min}
                        max={field.max}
                        step={field.step ?? "any"}
                        onChange={(e) => handleChange(field, e)}
                        placeholder={field.label}
                        inputMode="decimal"
                        disabled={disabled}
                      />

                      {field.key === "rrspContribute" && (
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 13,
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={rrspAuto}
                            onChange={(e) => handleRrspAutoToggle(e.target.checked)}
                          />
                          Auto
                        </label>
                      )}
                    </div>

                    {field.hint ? <div style={styles.hint}>{field.hint}</div> : null}
                    {err ? <div style={styles.errorText}>{err}</div> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div style={styles.actions}>
          <button type="submit" style={{ ...styles.btn, ...styles.btnPrimary }}>
            Submit
          </button>
          <button type="button" style={styles.btn} onClick={handleReset}>
            Reset
          </button>
        </div>
      </form>

      {/* Debug only:
        {submitted && (
          <pre>{JSON.stringify(submitted, null, 2)}</pre>
        )}
*/}
    </div>
  );
}
