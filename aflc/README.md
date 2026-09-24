# AFLC controller (Python)

A working implementation of the adaptive fuzzy logic controller we designed:
sensors → fuzzified deviation → ECL → (revised) Table 5 → hold delay →
irrigation demand → pump duration, plus the adaptive gain feedback loop.

Two files:

- **`aflc_controller.py`** — all the decision logic. No network/hardware
  dependencies, so you can unit-test it, import it anywhere, or just run it
  (`python3 aflc_controller.py`) to see it reason through six example
  scenarios.
- **`aflc_service.py`** — a small Flask wrapper so your existing Node/Express
  backend (or the React dashboard directly, if you want) can call this over
  HTTP instead of you reimplementing fuzzy logic in JavaScript.

Run the demo:
```bash
pip install -r requirements.txt
python3 aflc_controller.py
```

Run the HTTP service:
```bash
python3 aflc_service.py            # listens on :5001
curl -X POST localhost:5001/aflc/node1 \
  -H "Content-Type: application/json" \
  -d '{"temperature":33,"humidity":74,"co2":1100,"light":420,"chs":"healthy","chs_confidence":0.92}'
```

## ⚠️ Important: two mismatches with your existing dashboard code

I read through `src.zip` before writing this, and there are two things
you should decide on, because right now the paper's numbers and the
dashboard's numbers don't agree:

1. **The optimal ranges are different.**
   `config/thresholds.js` in your dashboard uses Temp 22–26°C, RH 60–75%,
   CO₂ 400–1200 ppm, and Light **5000–80000 lx**. Table 5 / your paper uses
   Temp 25–35°C, RH 83–87%, CO₂ 700–1200 ppm, and Light **200–500
   µmol·m⁻²·s⁻¹**. Those aren't just different numbers — lux and
   µmol·m⁻²·s⁻¹ are different physical units entirely (lux is a
   human-eye-weighted brightness measure; µmol·m⁻²·s⁻¹, PPFD, is what plants
   actually use), so if your BH1750 sensor reports lux, it cannot be plugged
   directly into Table 5's light band without a conversion factor specific
   to your LED spectrum.
   **I used Table 5's numbers** in `PARAM_BANDS` since that's the table you
   asked me to fix — the dashboard's display thresholds in
   `config/thresholds.js` are untouched and still independently control what
   the UI shows as "Optimal/Low/High" pills. If you want the dashboard's
   displayed status and the AFLC's decision to actually agree with each
   other, that's the thing to reconcile next — happy to help pick one set of
   numbers, or fix the lux→PPFD conversion, once you know your fixture's
   output spectrum.

2. **The existing frontend logic (`App.jsx`'s `calculateAFLCDecision`) doesn't
   use light or plant-disease status at all** — just temp/humidity/CO₂ with a
   simple point-scoring `if` chain (not actually fuzzy, and no Healthy/
   Diseased branching). This Python controller is the real fuzzy
   implementation described in Table 5; it's meant to **replace** that
   function's role, not run alongside it. `pages/Dashboard.jsx` has a third,
   different version again (soil moisture/pH based) — that file looks like
   an older/unused draft of the dashboard, not something currently wired
   into `App.jsx`'s routes.

## Where CHS (Healthy/Diseased) comes from

Nothing in `src.zip` currently classifies plant health from an image — there's
a camera capture button (`onCapture`/`cameraBusy` in the Overview view) but no
model output visible in this codebase. `evaluate()` takes `chs` and
`chs_confidence` as plain inputs, so wherever your disease-detection model
runs (on-device, a separate Python service, wherever), just have it hand its
label and confidence to `AFLCController.evaluate()`. If you haven't built
that classifier yet, pass `"chs": "healthy"` with no confidence for now — the
controller runs fine without it, it just won't get the longer Diseased-branch
hold delays until that model exists.

## How the pieces map to what we discussed

| Concept | Where it lives |
|---|---|
| Fuzzification (per-parameter deviation 0–1) | `fuzzify()`, `_deviation_degree()` |
| ECL inference (Rule Base 1) | `compute_ecl()` |
| Table 5 (Rule Base 2) | `HOLD_DELAY_TABLE` + `hold_delay_seconds()` |
| Hold-delay debounce | `AFLCController.evaluate()` — the `condition_since` state machine |
| Demand % → pump seconds | `compute_demand_pct()`, `base_duration_for_demand()` |
| Adaptive gain layer | `AdaptiveState`, `record_feedback()` |

## Wiring it into your existing backend

Your Node/Express backend already does exactly the right thing —
`api/services.js` posts to `/api/aflc/:id` on every sensor update
(`App.jsx` line ~391). Point that handler at this Flask service instead of
computing the decision in JS:

```js
// Express side, pseudo-code
app.post('/api/aflc/:nodeId', async (req, res) => {
  const r = await fetch(`http://localhost:5001/aflc/${req.params.nodeId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req.body), // {temperature, humidity, co2, light, chs, chs_confidence}
  });
  const decision = await r.json();
  await db.query('INSERT INTO aflc_log ...', decision); // as you do today
  res.json(decision);
});
```

The response's `decision` / `confidence` / `reason` fields mean exactly what
they do today, so `<AflcCard>` and the `.aflc-badge.irrigate/.monitor/.optimal`
CSS classes work with **zero frontend changes**. Everything else in the
response (`ecl`, `chs`, `holdDelaySec`, `demandPct`, `pumpDurationSec`, ...) is
new — surface it in the UI whenever you're ready; it's already in
`aflc.css`-friendly shape (a badge + a confidence value + a reason line, plus
now some extra numbers you could add as small stat rows).

When a decision comes back with `pumpDurationSec > 0`, that's your cue to
call the same motor/pump command you already send today
(`triggerMotor` / `POST /api/reservoir/motor/run` in `App.jsx`), just for
`pumpDurationSec` seconds instead of the hardcoded 15.

After the pump finishes and you get a fresh humidity reading, call:
```
POST /aflc/<nodeId>/feedback   { "postHumidity": 83.4 }
```
That's the adaptive step — it nudges the gain table so the same rules
produce a better duration next time that (ECL, demand-bracket) combination
comes up. No fuzzy rule ever changes; only the gain does.

## Tuning knobs (top of `aflc_controller.py`)

- `PARAM_BANDS` — the fuzzy low/ramp/optimal/ramp/high bands per sensor
- `CO2_CRITICAL_PPM` — hard override to force Critical
- `ECL_THRESHOLDS` — stress-score cut points between ECL levels
- `HOLD_DELAY_TABLE` — Table 5 itself
- `DEMAND_TO_DURATION` — the 0–15s bracket table
- `TARGET_RH`, `RH_ERROR_DEADBAND`, `GAIN_STEP_SECONDS` — adaptive layer
- `CHS_CONFIDENCE_FLOOR` — below this confidence, a "Healthy" label is
  treated as "Diseased" (cautious fallback)

All of these are just module-level constants/dicts — no need to touch the
logic functions to retune the controller.
