"""
Flask web server for PAGASA Signal Tracker.
Exposes the UI at GET / and the PDA analysis endpoint at POST /api/analyze.
"""
from flask import Flask, render_template, request, jsonify
from pda import run_pda_bfs

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/analyze", methods=["POST"])
def analyze():
    """
    Receives the complete list of bulletins from the browser, extracts wind speeds,
    and runs the full sequence through the PDA BFS engine in pda.py.
    """
    data = request.get_json(silent=True) or {}
    raw_bulletins = data.get("bulletins", [])

    readings = []
    datetimes = []
    for idx, item in enumerate(raw_bulletins):
        try:
            wind = int(item.get("wind", 0))
            if wind < 0:
                return jsonify({"error": f"Bulletin #{idx + 1}: wind speed must be a non-negative integer."}), 400
        except (ValueError, TypeError):
            return jsonify({"error": f"Bulletin #{idx + 1}: invalid wind speed."}), 400

        readings.append(wind)
        datetimes.append(str(item.get("datetime", "")))

    # Invoke the PDA engine on the entire sequence of readings
    pda_result = run_pda_bfs(readings)

    # Attach original datetime strings back to each analyzed bulletin
    for i, b in enumerate(pda_result["bulletins"]):
        b["datetime"] = datetimes[i]

    return jsonify(pda_result)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)