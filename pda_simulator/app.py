"""
Flask web server for Program 1: PAGASA Tropical Cyclone Wind Signal PDA Simulator.
"""

from flask import Flask, jsonify, render_template, request
from pda import parse_readings, simulate_pda

app = Flask(__name__)


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


@app.route("/api/run", methods=["POST"])
def api_run():
    data = request.get_json(silent=True) or {}
    raw_input = data.get("input", "")
    if not isinstance(raw_input, str):
        raw_input = str(raw_input)

    readings, error = parse_readings(raw_input)
    if error is not None:
        return jsonify({
            "accepted": False,
            "validation_error": True,
            "reason": error,
            "steps": [],
            "tape": [],
        }), 400

    result = simulate_pda(readings)
    result["validation_error"] = False
    return jsonify(result)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)