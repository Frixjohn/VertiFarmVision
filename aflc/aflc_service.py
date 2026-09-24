"""
aflc_service.py
─────────────────────────────────────────────────────────────────────────────
Tiny Flask microservice around AFLCController, so your existing Node/Express
backend (the one your React dashboard already calls via /api) can get AFLC
decisions from Python without you rewriting the fuzzy logic in JavaScript.

Run it:
    pip install flask
    python3 aflc_service.py            # listens on :5001

Wire it into your Express backend, e.g. in whatever handles
POST /api/aflc/:nodeId today (services.js -> aflcService.logDecision):

    // Express side (Node), pseudo-code
    app.post('/api/aflc/:nodeId', async (req, res) => {
      const pyRes = await fetch(`http://localhost:5001/aflc/${req.params.nodeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),   // { temperature, humidity, co2, light, chs, chs_confidence }
      });
      const decision = await pyRes.json();
      await db.query('INSERT INTO aflc_log ...', decision);   // persist as you do today
      res.json(decision);
    });

The JSON this returns includes `decision` / `confidence` / `reason` with the
exact same meaning as calculateAFLCDecision() in App.jsx today (IRRIGATE /
MONITOR / OPTIMAL), so the existing <AflcCard> badge classes
(aflc-badge.irrigate/.monitor/.optimal in aflc.css) keep working with zero
frontend changes. Everything else (ecl, holdDelaySec, demandPct,
pumpDurationSec, ...) is new — display it if/when you want the dashboard to
show more detail.

Endpoints:
    POST /aflc/<node_id>            body: sensor + CHS reading -> decision
    POST /aflc/<node_id>/feedback   body: {"postHumidity": 83.4} -> gain update
    GET  /aflc/<node_id>/state      current persisted controller state (debug)
"""

import os
from flask import Flask, request, jsonify

from aflc_controller import AFLCController

app = Flask(__name__)

# One state file per node, so hold-delay timers and adaptive gains don't
# collide between Node 1 / Node 2. Kept in ./state/ next to this script.
STATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state")
os.makedirs(STATE_DIR, exist_ok=True)

_controllers: dict[str, AFLCController] = {}


def get_controller(node_id: str) -> AFLCController:
    if node_id not in _controllers:
        state_path = os.path.join(STATE_DIR, f"{node_id}.json")
        _controllers[node_id] = AFLCController(node_id, state_path=state_path)
    return _controllers[node_id]


REQUIRED_FIELDS = ("temperature", "humidity", "co2", "light")


@app.post("/aflc/<node_id>")
def evaluate(node_id):
    body = request.get_json(force=True, silent=True) or {}
    missing = [f for f in REQUIRED_FIELDS if body.get(f) is None]
    if missing:
        return jsonify({"error": f"missing required field(s): {', '.join(missing)}"}), 400

    ctrl = get_controller(node_id)
    decision = ctrl.evaluate(body)
    return jsonify(decision)


@app.post("/aflc/<node_id>/feedback")
def feedback(node_id):
    body = request.get_json(force=True, silent=True) or {}
    if body.get("postHumidity") is None:
        return jsonify({"error": "missing required field: postHumidity"}), 400

    ctrl = get_controller(node_id)
    result = ctrl.record_feedback(post_humidity=float(body["postHumidity"]))
    if result is None:
        return jsonify({"note": "no pump run is pending feedback for this node"}), 200
    return jsonify(result)


@app.get("/aflc/<node_id>/state")
def state(node_id):
    ctrl = get_controller(node_id)
    return jsonify({
        "node": node_id,
        "gains": ctrl.state.gains,
        "conditionSince": ctrl.state.condition_since,
        "conditionKey": ctrl.state.condition_key,
        "lastDecision": ctrl.state.last_decision,
    })


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
