/**
 * Front-end logic for PAGASA Signal Tracker.
 * Communicates with POST /api/analyze on every bulletin change and updates
 * the timeline, vertical stack, compact SVG PDA diagram, and inline SVG wind chart.
 */

const SAMPLE_SPEEDS = [20, 45, 70, 95, 120, 190, 150, 100, 75, 50, 30];

const STATE_NAMES = {
    q0: "q0 (Idle / Finished)",
    q1: "q1 (Transition Hub)",
    q2: "q2 (No Signal)",
    q3: "q3 (Signal 1)",
    q4: "q4 (Signal 2)",
    q5: "q5 (Signal 3)",
    q6: "q6 (Signal 4)",
    q7: "q7 (Signal 5)",
};

let bulletinsInput = [];
let latestAnalysis = null;
let selectedRowIndex = null;

// DOM Elements
const dtInput = document.getElementById("dt-input");
const windInput = document.getElementById("wind-input");
const bulletinForm = document.getElementById("bulletin-form");
const formError = document.getElementById("form-error");
const sampleBadge = document.getElementById("sample-badge");
const timelineTbody = document.getElementById("timeline-tbody");

const sumPeak = document.getElementById("sum-peak");
const sumEsc = document.getElementById("sum-esc");
const sumDeesc = document.getElementById("sum-deesc");
const sumComplete = document.getElementById("sum-complete");
const sumReasonBox = document.getElementById("sum-reason-box");
const sumReasonText = document.getElementById("sum-reason-text");

const inspectorBadge = document.getElementById("inspector-mode-badge");
const liveBulletinNum = document.getElementById("live-bulletin-num");
const liveSignal = document.getElementById("live-signal");
const liveState = document.getElementById("live-state");
const stackVisual = document.getElementById("stack-visual");

function setDefaultDateTime() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dtInput.value = now.toISOString().slice(0, 16);
}

function advanceDateTimeByHours(isoStr, hours) {
    const d = isoStr ? new Date(isoStr) : new Date();
    d.setHours(d.getHours() + hours);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

function formatDateTimeDisplay(isoStr) {
    if (!isoStr) return "—";
    return isoStr.replace("T", " ");
}

function showError(msg) {
    if (!msg) {
        formError.textContent = "";
        formError.classList.add("hidden");
    } else {
        formError.textContent = msg;
        formError.classList.remove("hidden");
    }
}

function statusBadgeHTML(status) {
    if (status.startsWith("RAISED")) {
        return `<span class="status-badge status-raised">&#9650; ${status}</span>`;
    }
    if (status.startsWith("LOWERED")) {
        return `<span class="status-badge status-lowered">&#9660; ${status}</span>`;
    }
    if (status.startsWith("MAINTAINED")) {
        return `<span class="status-badge status-maintained">&#9644; ${status}</span>`;
    }
    if (status === "ALL CLEAR") {
        return `<span class="status-badge status-clear">&#10003; ${status}</span>`;
    }
    return `<span class="status-badge status-outside">&#9888; ${status}</span>`;
}

/**
 * Sends the entire bulletin sequence to POST /api/analyze to run the PDA engine.
 */
async function syncAndAnalyze() {
    try {
        const res = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bulletins: bulletinsInput }),
        });
        const data = await res.json();
        if (!res.ok) {
            showError(data.error || "Analysis failed.");
            return;
        }
        showError("");
        latestAnalysis = data;
        selectedRowIndex = data.bulletins.length > 0 ? data.bulletins.length - 1 : null;
        renderAll();
    } catch (err) {
        showError("Could not reach local Flask server.");
    }
}

function renderAll() {
    if (!latestAnalysis) return;
    renderSummary(latestAnalysis);
    renderTimelineTable(latestAnalysis.bulletins);
    renderInspector();
    renderWindChart(latestAnalysis.bulletins);
}

function renderSummary(data) {
    sumPeak.textContent = data.peak_signal === 0 ? "No Signal (0)" : `Signal ${data.peak_signal}`;
    sumEsc.textContent = data.escalations;
    sumDeesc.textContent = data.de_escalations;

    if (data.bulletins.length === 0) {
        sumComplete.textContent = "Yes (Idle)";
        sumComplete.className = "metric-value status-yes";
        sumReasonBox.classList.add("hidden");
    } else if (data.accepted) {
        sumComplete.textContent = "Yes";
        sumComplete.className = "metric-value status-yes";
        sumReasonBox.classList.add("hidden");
    } else {
        sumComplete.textContent = "No";
        sumComplete.className = "metric-value status-no";
        sumReasonText.textContent = data.reason;
        sumReasonBox.classList.remove("hidden");
    }
}

function renderTimelineTable(bulletins) {
    if (bulletins.length === 0) {
        timelineTbody.innerHTML = `<tr><td colspan="7" class="empty-row">No bulletins logged yet. Add a reading or click "Load sample scenario".</td></tr>`;
        return;
    }

    timelineTbody.innerHTML = bulletins
        .map((b, idx) => {
            const isSelected = idx === selectedRowIndex ? "selected-row" : "";
            const stackText = b.stack.length > 0 ? b.stack.join(" → ") : "ε (empty)";
            return `
            <tr class="${isSelected}" data-idx="${idx}">
                <td><strong>${b.index}</strong></td>
                <td>${formatDateTimeDisplay(b.datetime)}</td>
                <td><strong>${b.wind} km/h</strong> <span style="color:#64748b;font-size:0.75rem;">(${b.band_label})</span></td>
                <td>${b.signal_label}</td>
                <td>${statusBadgeHTML(b.status)}</td>
                <td><code>${b.pda_state}</code></td>
                <td><code>${stackText}</code></td>
            </tr>`;
        })
        .join("");

    timelineTbody.querySelectorAll("tr[data-idx]").forEach((row) => {
        row.addEventListener("click", () => {
            selectedRowIndex = parseInt(row.getAttribute("data-idx"), 10);
            renderTimelineTable(latestAnalysis.bulletins);
            renderInspector();
        });
    });
}

function renderInspector() {
    const bulletins = latestAnalysis ? latestAnalysis.bulletins : [];
    if (bulletins.length === 0 || selectedRowIndex === null) {
        inspectorBadge.textContent = "Idle (Start)";
        liveBulletinNum.textContent = "None";
        liveSignal.textContent = "No Signal (0)";
        liveState.textContent = STATE_NAMES["q0"];
        renderStackVisual([]);
        highlightDiagram("q0", null);
        return;
    }

    const b = bulletins[selectedRowIndex];
    const isLatest = selectedRowIndex === bulletins.length - 1;
    inspectorBadge.textContent = isLatest
        ? `Live (Bulletin #${b.index})`
        : `Historical (Bulletin #${b.index} of ${bulletins.length})`;

    liveBulletinNum.textContent = `#${b.index} (${b.wind} km/h)`;
    liveSignal.textContent = b.signal_label;
    liveState.textContent = STATE_NAMES[b.pda_state] || b.pda_state;

    renderStackVisual(b.stack);
    highlightDiagram(b.pda_state, b.read_edge || b.edge);
}

function renderStackVisual(stackArr) {
    if (!stackArr || stackArr.length === 0) {
        stackVisual.innerHTML = `<div class="stack-empty">Empty Stack (&epsilon;)</div>`;
        return;
    }
    stackVisual.innerHTML = stackArr
        .map((sym, i) => {
            const isZ0 = sym === "Z0" ? "z0-cell" : "";
            const posTag = i === stackArr.length - 1 ? " (Top)" : i === 0 ? " (Bottom)" : "";
            return `<div class="stack-cell ${isZ0}">${sym}${posTag}</div>`;
        })
        .join("");
}

function highlightDiagram(stateId, edgeId) {
    document.querySelectorAll("#pda-diagram-svg .pda-node").forEach((node) => {
        if (node.getAttribute("data-state") === stateId) {
            node.classList.add("active-node");
        } else {
            node.classList.remove("active-node");
        }
    });

    document.querySelectorAll("#pda-diagram-svg .pda-edge").forEach((edge) => {
        const lineOrPath = edge.querySelector("line, path");
        if (edge.getAttribute("data-edge") === edgeId) {
            edge.classList.add("active-edge");
            if (lineOrPath) lineOrPath.setAttribute("marker-end", "url(#arrow-active)");
        } else {
            edge.classList.remove("active-edge");
            if (lineOrPath) lineOrPath.setAttribute("marker-end", "url(#arrow)");
        }
    });
}

function renderWindChart(bulletins) {
    const svg = document.getElementById("wind-chart-svg");
    const width = 720;
    const height = 250;
    const padLeft = 48;
    const padRight = 78;
    const padTop = 20;
    const padBottom = 32;

    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const maxWind = Math.max(210, ...bulletins.map((b) => b.wind));
    const yScale = (val) => padTop + plotH - (val / maxWind) * plotH;

    const thresholds = [
        { kmh: 39, label: "Signal 1 (39)" },
        { kmh: 62, label: "Signal 2 (62)" },
        { kmh: 89, label: "Signal 3 (89)" },
        { kmh: 118, label: "Signal 4 (118)" },
        { kmh: 185, label: "Signal 5 (185)" },
    ];

    let html = `
        <rect x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1"/>
    `;

    // Threshold dashed lines
    thresholds.forEach((t) => {
        const y = yScale(t.kmh).toFixed(1);
        html += `
            <line x1="${padLeft}" y1="${y}" x2="${padLeft + plotW}" y2="${y}" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="5,4"/>
            <text x="${padLeft + plotW + 6}" y="${parseFloat(y) + 4}" font-size="10.5" font-weight="600" fill="#475569">${t.label}</text>
        `;
    });

    // Y-axis 0 label
    html += `<text x="${padLeft - 8}" y="${yScale(0) + 4}" text-anchor="end" font-size="10.5" fill="#475569">0 km/h</text>`;

    if (bulletins.length > 0) {
        const xStep = bulletins.length === 1 ? 0 : plotW / (bulletins.length - 1);
        const pts = bulletins.map((b, i) => {
            const x = bulletins.length === 1 ? padLeft + plotW / 2 : padLeft + i * xStep;
            const y = yScale(b.wind);
            return { x, y, b, i };
        });

        // Polyline
        if (pts.length > 1) {
            const polyPoints = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
            html += `<polyline fill="none" stroke="#1d4ed8" stroke-width="2.5" points="${polyPoints}"/>`;
        }

        // Data points and X-axis bulletin labels
        pts.forEach((p) => {
            const isOutside = p.b.status === "OUTSIDE MODEL";
            const fill = isOutside ? "#dc2626" : "#1d4ed8";
            html += `
                <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="${fill}" stroke="#fff" stroke-width="1.5"/>
                <text x="${p.x.toFixed(1)}" y="${(p.y - 8).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#0f172a">${p.b.wind}</text>
                <text x="${p.x.toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="10.5" fill="#475569">#${p.b.index}</text>
            `;
        });
    } else {
        html += `<text x="${padLeft + plotW / 2}" y="${padTop + plotH / 2}" text-anchor="middle" font-size="12" fill="#64748b">Add wind readings to plot chart</text>`;
    }

    svg.innerHTML = html;
}

// Event Listeners
bulletinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const rawWind = windInput.value.trim();
    if (rawWind === "" || !/^\d+$/.test(rawWind)) {
        showError("Please enter a valid non-negative integer wind speed (km/h).");
        return;
    }
    const windVal = parseInt(rawWind, 10);
    const dtVal = dtInput.value || new Date().toISOString().slice(0, 16);

    sampleBadge.classList.add("hidden");
    bulletinsInput.push({ datetime: dtVal, wind: windVal });
    dtInput.value = advanceDateTimeByHours(dtVal, 3);
    windInput.value = "";
    windInput.focus();
    syncAndAnalyze();
});

document.getElementById("btn-delete-last").addEventListener("click", () => {
    if (bulletinsInput.length === 0) return;
    bulletinsInput.pop();
    if (bulletinsInput.length === 0) sampleBadge.classList.add("hidden");
    syncAndAnalyze();
});

document.getElementById("btn-clear").addEventListener("click", () => {
    bulletinsInput = [];
    sampleBadge.classList.add("hidden");
    setDefaultDateTime();
    syncAndAnalyze();
});

document.getElementById("btn-sample").addEventListener("click", () => {
    let baseDt = "2026-10-24T06:00";
    bulletinsInput = SAMPLE_SPEEDS.map((w, idx) => {
        const dt = idx === 0 ? baseDt : advanceDateTimeByHours(baseDt, idx * 3);
        return { datetime: dt, wind: w };
    });
    sampleBadge.classList.remove("hidden");
    syncAndAnalyze();
});

document.getElementById("btn-export-csv").addEventListener("click", () => {
    if (!latestAnalysis || latestAnalysis.bulletins.length === 0) {
        showError("No timeline data to export.");
        return;
    }
    const locality = document.getElementById("locality-input").value.trim() || "Unspecified";
    const headers = ["Bulletin #", "Locality", "Date-Time", "Wind Speed (km/h)", "Signal", "Status", "PDA State", "Stack"];
    const rows = latestAnalysis.bulletins.map((b) => [
        b.index,
        `"${locality.replace(/"/g, '""')}"`,
        `"${b.datetime}"`,
        b.wind,
        `"${b.signal_label}"`,
        `"${b.status}"`,
        b.pda_state,
        `"${b.stack.join(" ")}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pagasa_signal_timeline.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// Initialize on load
setDefaultDateTime();
syncAndAnalyze();