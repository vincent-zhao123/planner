// server.js
const express = require("express");
const cors = require("cors");
const ExcelJS = require("exceljs");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.send("ok");
});

// ---------- helpers ----------
const toNum = (v) => {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (s === "") return 0;
  const cleaned = s.replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const toInt = (v, def = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

// 2 -> 0.02, 0.02 -> 0.02
const normalizeRate = (x) => {
  const n = toNum(x);
  return n > 1 ? n / 100 : n;
};

/**
 * Constant RRSP withdrawal W in retirement years such that final RRSP balance ≈ 0.
 *
 * IMPORTANT TIMELINE (per your latest rule):
 * - Year 0 (first row): initial balance = user input (NO ROI applied)
 * - Year t>0: initial balance = last year's ending balance * (1 + ROI)
 * - Ending balance = initial + contribution - withdrawal
 */
function solveRRSPWithdrawal({
  yearsToRetire,
  yearsToPlan,
  rrspInitialBalance,
  rrspContribute,
  rrspRoi,
}) {
  const simulate = (W) => {
    let endBalPrev = rrspInitialBalance; // end of year -1 conceptually
    for (let t = 0; t < yearsToPlan; t++) {
      const init = t === 0 ? rrspInitialBalance : endBalPrev * (1 + rrspRoi);
      const contrib = t < yearsToRetire ? rrspContribute : 0;
      const withdraw = t >= yearsToRetire ? W : 0;
      const endBal = init + contrib - withdraw;
      endBalPrev = endBal;
    }
    return endBalPrev;
  };

  // final(W) is linear in W, so compute with W=0 and W=1
  const a = simulate(0);
  const a1 = simulate(1);
  const b = a - a1;

  return b > 0 ? Math.max(0, a / b) : 0;
}

app.post("/api/generate-excel", async (req, res) => {
  try {
    const d = req.body || {};

    // ---- INPUTS (EXACT NAMES YOU PROVIDED) ----
    const currentAge = toInt(d.currentAge);
    const yearsToRetire = Math.max(0, toInt(d.yearsToRetire));
    const yearsToPlan = Math.max(1, toInt(d.yearsToPlan));

    const incomeAnnual = toNum(d.incomeAnnual);
    const expensesAnnual = toNum(d.expensesAnnual);
    const inflationRate = normalizeRate(d.inflationRate);

    const rrspInitialBalance = toNum(d.rrspInitialBalance);
    const rrspContribute = toNum(d.rrspContribute);
    const rrspRoi = normalizeRate(d.rrspRoi);

    const tfsaInitialBalance = toNum(d.tfsaInitialBalance);
    const tfsaContribute = toNum(d.tfsaContribute);
    const tfsaRoi = normalizeRate(d.tfsaRoi);

    const nonRegisteredInitialBalance = toNum(d.nonRegisteredInitialBalance);
    const nonRegisteredRoi = normalizeRate(d.nonRegisteredRoi);

    // ---- Solve RRSP fixed withdrawal (retirement years) ----
    const rrspWithdrawFixed = solveRRSPWithdrawal({
      yearsToRetire,
      yearsToPlan,
      rrspInitialBalance,
      rrspContribute,
      rrspRoi,
    });

    // ---- Simulation ----
    // Store "previous year ending balance" for years > 0 initialization
    let rrspEndPrev = rrspInitialBalance;
    let tfsaEndPrev = tfsaInitialBalance;
    let nonrEndPrev = nonRegisteredInitialBalance;

    const rows = [];

    const EPS = 1e-9;
    let tfsaDepleted = false;
    let tfsaCleared = false;

    for (let t = 0; t < yearsToPlan; t++) {
      const age = currentAge + t;
      const income = t < yearsToRetire ? incomeAnnual : 0;
      const expense = expensesAnnual * Math.pow(1 + inflationRate, t);

      // ===== RRSP =====
      const rrspInit = t === 0 ? rrspInitialBalance : rrspEndPrev * (1 + rrspRoi);
      const rrspC = t < yearsToRetire ? rrspContribute : 0;
      const rrspW = t >= yearsToRetire ? rrspWithdrawFixed : 0;
      const rrspEnd = rrspInit + rrspC - rrspW;
      rrspEndPrev = rrspEnd;

      // ===== TFSA =====
      const tfsaInit = t === 0 ? tfsaInitialBalance : tfsaEndPrev * (1 + tfsaRoi);
      const tfsaC = t < yearsToRetire ? tfsaContribute : 0;
      let tfsaW = 0; // only used after non-registered is depleted/insufficient (in retirement)

      // ===== NON-REGISTERED =====
      const nonrInit =
        t === 0 ? nonRegisteredInitialBalance : nonrEndPrev * (1 + nonRegisteredRoi);

      // Working years contribution rule:
      // non-r contribute = income - expense - rrsp contribute - tfsa contribute (only when income != 0)
      const nonrC =
        income > 0 ? Math.max(0, income - expense - rrspC - tfsaC) : 0;

      let nonrW = 0;

      // Retirement spending coverage: RRSP fixed -> NON-R -> TFSA (only once NON-R can’t cover)
      if (income === 0) {
        const needAfterRRSP = Math.max(0, expense - rrspW);

        nonrW = Math.min(nonrInit, needAfterRRSP);
        const remaining = needAfterRRSP - nonrW;

        if (remaining > 0) {
          tfsaW = Math.min(tfsaInit + tfsaC, remaining);
        }
      }

      const nonrEnd = nonrInit + nonrC - nonrW;
      nonrEndPrev = nonrEnd;

      // TFSA end balance (use let because we may clamp)
      let tfsaEnd = tfsaInit + tfsaC - tfsaW;

      // clamp tiny negatives to 0
      if (tfsaEnd < EPS) tfsaEnd = 0;

      // once TFSA hits 0, mark depleted (and keep it depleted)
      if (tfsaInit === 0) tfsaDepleted = true;

      // if depleted, force withdraw to 0 and keep balance at 0 going forward
      if (tfsaDepleted) {
        tfsaW = 0;
        tfsaEnd = 0;
      }

      tfsaEndPrev = tfsaEnd;


      rows.push({
        age,
        income,
        expense,

        rrspInit,
        rrspC,
        rrspW,
        rrspEnd,

        tfsaInit,
        tfsaC,
        tfsaW,
        tfsaEnd,

        nonrInit,
        nonrC,
        nonrW,
        nonrEnd,
      });
    }

    // ---- Excel ----
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Projection");

    // Row 1 (group headers)
    ws.getRow(1).values = [
      "Current Age",
      "RRSP", null, null, null,
      "TFSA", null, null, null,
      "NON-R", null, null, null,
      "Income",
      "Expense",
    ];
    ws.mergeCells("B1:E1");
    ws.mergeCells("F1:I1");
    ws.mergeCells("J1:M1");

    // Row 2 (sub headers)
    ws.getRow(2).values = [
      "",
      "RRSP", "RRSP Contribute", "RRSP Withdraw", "RRSP Balance",
      "TFSA", "TFSA Contribute", "TFSA Withdraw", "TFSA Balance",
      "NON-R", "NON-R Contribute", "NON-R Withdraw", "NON-R Balance",
      "",
      "",
    ];

    ws.columns = [
      { width: 12 }, // A
      { width: 16 }, { width: 18 }, { width: 18 }, { width: 18 }, // RRSP
      { width: 16 }, { width: 18 }, { width: 18 }, { width: 18 }, // TFSA
      { width: 16 }, { width: 20 }, { width: 18 }, { width: 18 }, // NON-R
      { width: 14 }, // income
      { width: 14 }, // expense
    ];

    // Styling blocks similar to your screenshot
    const fillRRSP = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF99" } };
    const fillTFSA = { type: "pattern", pattern: "solid", fgColor: { argb: "9FD9FF" } };
    const fillNONR = { type: "pattern", pattern: "solid", fgColor: { argb: "BFE3B4" } };

    const setFillRange = (cells, fill) =>
      cells.forEach((c) => (ws.getCell(c).fill = fill));

    setFillRange(["B1","C1","D1","E1","B2","C2","D2","E2"], fillRRSP);
    setFillRange(["F1","G1","H1","I1","F2","G2","H2","I2"], fillTFSA);
    setFillRange(["J1","K1","L1","M1","J2","K2","L2","M2"], fillNONR);

    [1, 2].forEach((r) => {
      ws.getRow(r).font = { bold: true };
      ws.getRow(r).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    ws.getRow(1).height = 22;
    ws.getRow(2).height = 26;

    // Data rows
    const startRow = 3;
    rows.forEach((row, i) => {
      const r = startRow + i;

      ws.getCell(`A${r}`).value = row.age;

      ws.getCell(`B${r}`).value = row.rrspInit;
      ws.getCell(`C${r}`).value = row.rrspC;
      ws.getCell(`D${r}`).value = row.rrspW;
      ws.getCell(`E${r}`).value = row.rrspEnd;

      if (!tfsaCleared && row.tfsaInit <= 0) {
        tfsaCleared = true;
      }

      ws.getCell(`F${r}`).value = tfsaCleared ? null : row.tfsaInit;
      ws.getCell(`G${r}`).value = tfsaCleared ? null : row.tfsaC;
      ws.getCell(`H${r}`).value = tfsaCleared ? null : row.tfsaW;
      ws.getCell(`I${r}`).value = tfsaCleared ? null : row.tfsaEnd;

      ws.getCell(`J${r}`).value = row.nonrInit;
      ws.getCell(`K${r}`).value = row.nonrC;
      ws.getCell(`L${r}`).value = row.nonrW;
      ws.getCell(`M${r}`).value = row.nonrEnd;

      ws.getCell(`N${r}`).value = row.income;
      ws.getCell(`O${r}`).value = row.expense;
    });

    // Money formatting
    const moneyFmt = '"$"#,##0;[Red]-"$"#,##0';
    for (let r = startRow; r < startRow + rows.length; r++) {
      ["B","C","D","E","F","G","H","I","J","K","L","M","N","O"].forEach((c) => {
        ws.getCell(`${c}${r}`).numFmt = moneyFmt;
      });
    }

    // Show fixed RRSP withdrawal
    ws.getCell("Q1").value = "RRSP Fixed Withdrawal";
    ws.getCell("R1").value = rrspWithdrawFixed;
    ws.getCell("R1").numFmt = moneyFmt;
    ws.getCell("Q1").font = { bold: true };

    const buffer = await wb.xlsx.writeBuffer();

    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="retirement_projection.xlsx"',
      "Content-Length": buffer.byteLength,
    });

    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
