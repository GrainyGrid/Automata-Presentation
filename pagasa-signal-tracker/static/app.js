/*
 * Front-end logic for PAGASA Signal Tracker — Auto-Simulation Mode.
 * A predefined wind-speed sequence drives the PDA through a full
 * escalation (Signal 1→5) then de-escalation (Signal 5→1) lifecycle.
 */

// ---------------------------------------------------------------------------
// Predefined simulation sequence: escalate 1-5, hold briefly, de-escalate 5-1
// Each entry escalates one signal level, holds one reading, then drops.
// Speeds chosen to land squarely within each PAGASA band.
// Band edges: 0-38 | 39-61 | 62-88 | 89-117 | 118-184 | ≥185
// ---------------------------------------------------------------------------
const SIM_SPEEDS = [
    //  --- Calm start ---
    20,          // No Signal (calm)
    // --- Escalation ---
    50,          // Signal 1  (39-61)
    50,          // Signal 1  (maintain)
    75,          // Signal 2  (62-88)
    75,          // Signal 2  (maintain)
    100,         // Signal 3  (89-117)
    100,         // Signal 3  (maintain)
    150,         // Signal 4  (118-184)
    150,         // Signal 4  (maintain)
    200,         // Signal 5  (≥185)
    200,         // Signal 5  (maintain)
    // --- De-escalation ---
    150,         // Signal 4  (118-184)
    100,         // Signal 3  (89-117)
    75,          // Signal 2  (62-88)
    50,          // Signal 1  (39-61)
    20,          // No Signal / All Clear
];

// Bulletin hours in PHT (24 h values)
const BULLETIN_HOURS = [5, 11, 17, 23];

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

// Simulation state
let bulletinsInput = [];
let latestAnalysis = null;
let selectedRowIndex = null;

let simStepIndex = 0;       // how many steps have been submitted so far
let simRunning = false;
let simTimer = null;

// Starting date for simulation bulletins
const SIM_START_DATE = "2026-10-24";

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const timelineTbody     = document.getElementById("timeline-tbody");
const sumPeak           = document.getElementById("sum-peak");
const sumEsc            = document.getElementById("sum-esc");
const sumDeesc          = document.getElementById("sum-deesc");
const sumComplete       = document.getElementById("sum-complete");
const sumReasonBox      = document.getElementById("sum-reason-box");
const sumReasonText     = document.getElementById("sum-reason-text");
const inspectorBadge    = document.getElementById("inspector-mode-badge");
const liveBulletinNum   = document.getElementById("live-bulletin-num");
const liveSignal        = document.getElementById("live-signal");
const liveState         = document.getElementById("live-state");
const liveWind          = document.getElementById("live-wind");
const simPhaseBadge     = document.getElementById("sim-phase-badge");
const simProgressBar    = document.getElementById("sim-progress-bar");
const simStepLabel      = document.getElementById("sim-step-label");
const btnPlay           = document.getElementById("btn-play");
const btnStep           = document.getElementById("btn-step");
const btnReset          = document.getElementById("btn-reset");
const speedSelect       = document.getElementById("speed-select");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDatetime(dateStr, hourVal) {
    const h = String(hourVal).padStart(2, "0");
    return `${dateStr}T${h}:00`;
}

function advanceToNextBulletinSlot(dateStr, hourVal) {
    const idx = BULLETIN_HOURS.indexOf(Number(hourVal));
    if (idx === -1 || idx === BULLETIN_HOURS.length - 1) {
        const d = new Date(dateStr + "T00:00:00");
        d.setDate(d.getDate() + 1);
        const y  = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, "0");
        const dy = String(d.getDate()).padStart(2, "0");
        return { date: `${y}-${mo}-${dy}`, hour: BULLETIN_HOURS[0] };
    }
    return { date: dateStr, hour: BULLETIN_HOURS[idx + 1] };
}

function formatDateTimeDisplay(isoStr) {
    if (!isoStr) return "—";
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr.replace("T", " ");
    const day    = String(d.getDate()).padStart(2, "0");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const mon    = months[d.getMonth()];
    const year   = d.getFullYear();
    const h      = d.getHours();
    const hDisp  = h === 0 ? "12" : h > 12 ? String(h - 12).padStart(2,"0") : String(h).padStart(2,"0");
    const ampm   = h < 12 ? "AM" : "PM";
    const min    = String(d.getMinutes()).padStart(2, "0");
    return `${day} ${mon} ${year}, ${hDisp}:${min} ${ampm} PHT`;
}

function statusDisplayText(status) {
    if (status.startsWith("RAISED")) {
        const m = status.match(/Signal (\d+)/i);
        return `Wind Signal No. ${m ? m[1] : "?"} hoisted`;
    }
    if (status.startsWith("LOWERED")) {
        const m = status.match(/Signal (\d+)/i);
        if (m && m[1] === "0") return "De-escalated; no signal remains";
        return `De-escalated to Wind Signal No. ${m ? m[1] : "?"}`;
    }
    if (status.startsWith("MAINTAINED")) {
        const m = status.match(/Signal (\d+)/i);
        return `Remains under Wind Signal No. ${m ? m[1] : "?"}`;
    }
    if (status === "ALL CLEAR") return "All wind signals lifted";
    return "Signal progression outside orderly model";
}

function statusBadgeClass(status) {
    if (status.startsWith("RAISED"))     return "status-raised";
    if (status.startsWith("LOWERED"))    return "status-lowered";
    if (status.startsWith("MAINTAINED")) return "status-maintained";
    if (status === "ALL CLEAR")          return "status-clear";
    return "status-outside";
}

function statusBadgeHTML(status) {
    const cls  = statusBadgeClass(status);
    const text = statusDisplayText(status);
    return `<span class="status-badge ${cls}">${text}</span>`;
}

// Determine sim phase label from current step index
function simPhaseLabel(idx) {
    if (idx === 0) return "Ready";
    if (idx <= 1)  return "Calm";
    if (idx <= 11) return "↑ Escalating";
    if (idx < SIM_SPEEDS.length) return "↓ De-escalating";
    return "Complete";
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function syncAndAnalyze() {
    try {
        const res  = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bulletins: bulletinsInput }),
        });
        const data = await res.json();
        if (!res.ok) return;
        latestAnalysis = data;
        selectedRowIndex = data.bulletins.length > 0 ? data.bulletins.length - 1 : null;
        renderAll();
    } catch (_) {
        /* silently ignore network errors during auto-play */
    }
}

// ---------------------------------------------------------------------------
// Simulation control
// ---------------------------------------------------------------------------

// Derive current date/hour from simStepIndex
function datetimeForStep(stepIdx) {
    let dateStr = SIM_START_DATE;
    let hourIdx = 0;
    for (let i = 0; i < stepIdx; i++) {
        hourIdx++;
        if (hourIdx >= BULLETIN_HOURS.length) {
            hourIdx = 0;
            const d = new Date(dateStr + "T00:00:00");
            d.setDate(d.getDate() + 1);
            dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        }
    }
    return buildDatetime(dateStr, BULLETIN_HOURS[hourIdx]);
}

function stepForward() {
    if (simStepIndex >= SIM_SPEEDS.length) {
        stopPlay();
        return;
    }
    const wind = SIM_SPEEDS[simStepIndex];
    const dt   = datetimeForStep(simStepIndex);
    bulletinsInput.push({ datetime: dt, wind });
    simStepIndex++;
    updateSimUI();
    syncAndAnalyze();
}

function updateSimUI() {
    const total   = SIM_SPEEDS.length;
    const done    = simStepIndex;
    const pct     = ((done / total) * 100).toFixed(1);
    simProgressBar.style.width = pct + "%";
    simStepLabel.textContent   = `Step ${done} / ${total}`;
    simPhaseBadge.textContent  = simPhaseLabel(done);

    const finished = done >= total;
    btnPlay.disabled = finished;
    btnStep.disabled = finished;
    if (finished) stopPlay();
}

function startPlay() {
    if (simRunning || simStepIndex >= SIM_SPEEDS.length) return;
    simRunning = true;
    btnPlay.textContent = "⏸ Pause";
    tick();
}

function tick() {
    if (!simRunning) return;
    stepForward();
    if (simStepIndex < SIM_SPEEDS.length) {
        const delay = parseInt(speedSelect.value, 10) || 1000;
        simTimer = setTimeout(tick, delay);
    } else {
        stopPlay();
    }
}

function stopPlay() {
    simRunning = false;
    clearTimeout(simTimer);
    simTimer = null;
    btnPlay.textContent = "▶ Play";
}

function resetSim() {
    stopPlay();
    simStepIndex  = 0;
    bulletinsInput = [];
    latestAnalysis = null;
    selectedRowIndex = null;
    updateSimUI();
    simPhaseBadge.textContent = "Ready";
    simProgressBar.style.width = "0%";
    simStepLabel.textContent = `Step 0 / ${SIM_SPEEDS.length}`;
    btnPlay.disabled = false;
    btnStep.disabled = false;
    renderAll();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderAll() {
    if (!latestAnalysis) {
        // Reset state — no bulletins yet
        timelineTbody.innerHTML = `<tr><td colspan="6" class="empty-row">Press Play or Step Forward to begin the simulation.</td></tr>`;
        sumPeak.textContent     = "No Signal (0)";
        sumEsc.textContent      = "0";
        sumDeesc.textContent    = "0";
        sumComplete.textContent = "Yes (Idle)";
        sumComplete.className   = "status-yes";
        sumReasonBox.classList.add("hidden");
        inspectorBadge.textContent  = "Idle (Start)";
        liveBulletinNum.textContent = "None";
        liveSignal.textContent      = "No Signal (0)";
        liveState.textContent       = STATE_NAMES["q0"];
        liveWind.textContent        = "— km/h";
        renderWindChart([]);
        return;
    }
    renderSummary(latestAnalysis);
    renderTimelineTable(latestAnalysis.bulletins);
    renderInspector();
    renderWindChart(latestAnalysis.bulletins);
}

function renderSummary(data) {
    sumPeak.textContent  = data.peak_signal === 0 ? "No Signal (0)" : `Wind Signal No. ${data.peak_signal}`;
    sumEsc.textContent   = data.escalations;
    sumDeesc.textContent = data.de_escalations;

    if (data.bulletins.length === 0) {
        sumComplete.textContent = "Yes (Idle)";
        sumComplete.className   = "status-yes";
        sumReasonBox.classList.add("hidden");
    } else if (data.accepted) {
        sumComplete.textContent = "Yes";
        sumComplete.className   = "status-yes";
        sumReasonBox.classList.add("hidden");
    } else {
        sumComplete.textContent = "No";
        sumComplete.className   = "status-no";
        sumReasonText.textContent = data.reason;
        sumReasonBox.classList.remove("hidden");
    }
}

function renderTimelineTable(bulletins) {
    if (bulletins.length === 0) {
        timelineTbody.innerHTML = `<tr><td colspan="6" class="empty-row">Press Play or Step Forward to begin the simulation.</td></tr>`;
        return;
    }

    timelineTbody.innerHTML = bulletins
        .map((b, idx) => {
            const isSelected = idx === selectedRowIndex ? "selected-row" : "";
            return `
            <tr class="${isSelected}" data-idx="${idx}">
                <td><strong>${b.index}</strong></td>
                <td>${formatDateTimeDisplay(b.datetime)}</td>
                <td><strong>${b.wind} km/h</strong> <span style="color:#666;font-size:11px;">(${b.band_label})</span></td>
                <td>${b.signal_label}</td>
                <td>${statusBadgeHTML(b.status)}</td>
                <td><code>${b.pda_state}</code></td>
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

    // Auto-scroll to bottom so latest entry is always visible
    const tableWrap = timelineTbody.closest(".table-responsive");
    if (tableWrap) tableWrap.scrollTop = tableWrap.scrollHeight;
}

function renderInspector() {
    const bulletins = latestAnalysis ? latestAnalysis.bulletins : [];
    if (bulletins.length === 0 || selectedRowIndex === null) {
        inspectorBadge.textContent  = "Idle (Start)";
        liveBulletinNum.textContent = "None";
        liveSignal.textContent      = "No Signal (0)";
        liveState.textContent       = STATE_NAMES["q0"];
        liveWind.textContent        = "— km/h";
        return;
    }

    const b        = bulletins[selectedRowIndex];
    const isLatest = selectedRowIndex === bulletins.length - 1;
    inspectorBadge.textContent = isLatest
        ? `Live (Bulletin #${b.index})`
        : `Historical (Bulletin #${b.index} of ${bulletins.length})`;

    liveBulletinNum.textContent = `#${b.index}`;
    liveSignal.textContent      = b.signal_label;
    liveState.textContent       = STATE_NAMES[b.pda_state] || b.pda_state;
    liveWind.textContent        = `${b.wind} km/h`;
}

function renderWindChart(bulletins) {
    const svg      = document.getElementById("wind-chart-svg");
    const width    = 720, height = 260;
    const padLeft  = 52, padRight = 88, padTop = 16, padBottom = 30;
    const plotW    = width - padLeft - padRight;
    const plotH    = height - padTop - padBottom;

    const maxWind  = Math.max(210, ...bulletins.map((b) => b.wind));
    const yScale   = (val) => padTop + plotH - (val / maxWind) * plotH;

    const thresholds = [
        { kmh: 39,  label: "Sig.1 (39)"  },
        { kmh: 62,  label: "Sig.2 (62)"  },
        { kmh: 89,  label: "Sig.3 (89)"  },
        { kmh: 118, label: "Sig.4 (118)" },
        { kmh: 185, label: "Sig.5 (185)" },
    ];

    let html = `<rect x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="#ffffff" stroke="#cccccc" stroke-width="1"/>`;

    for (let v = 50; v <= maxWind; v += 50) {
        const y = yScale(v).toFixed(1);
        html += `<line x1="${padLeft}" y1="${y}" x2="${padLeft + plotW}" y2="${y}" stroke="#eeeeee" stroke-width="1"/>`;
        html += `<text x="${padLeft - 4}" y="${parseFloat(y) + 4}" text-anchor="end" font-size="10" fill="#888888">${v}</text>`;
    }
    html += `<text x="${padLeft - 4}" y="${yScale(0) + 4}" text-anchor="end" font-size="10" fill="#888888">0</text>`;
    html += `<text transform="rotate(-90)" x="${-(padTop + plotH / 2)}" y="12" text-anchor="middle" font-size="10" fill="#666666">km/h</text>`;

    thresholds.forEach((t) => {
        const y = yScale(t.kmh).toFixed(1);
        html += `
            <line x1="${padLeft}" y1="${y}" x2="${padLeft + plotW}" y2="${y}" stroke="#888888" stroke-width="1" stroke-dasharray="4,3"/>
            <text x="${padLeft + plotW + 5}" y="${parseFloat(y) + 4}" font-size="10" fill="#555555">${t.label}</text>
        `;
    });

    if (bulletins.length > 0) {
        const xStep = bulletins.length === 1 ? 0 : plotW / (bulletins.length - 1);
        const pts   = bulletins.map((b, i) => {
            const x = bulletins.length === 1 ? padLeft + plotW / 2 : padLeft + i * xStep;
            const y = yScale(b.wind);
            return { x, y, b, i };
        });

        if (pts.length > 1) {
            const polyPoints = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
            html += `<polyline fill="none" stroke="#1a56db" stroke-width="1.8" points="${polyPoints}"/>`;
        }

        pts.forEach((p) => {
            const isOutside  = p.b.status === "OUTSIDE MODEL";
            const fill       = isOutside ? "#aa0000" : "#1a56db";
            const markerSize = 4;
            html += `
                <rect x="${(p.x - markerSize).toFixed(1)}" y="${(p.y - markerSize).toFixed(1)}"
                    width="${markerSize * 2}" height="${markerSize * 2}"
                    fill="${fill}" stroke="#ffffff" stroke-width="1"/>
                <text x="${p.x.toFixed(1)}" y="${(p.y - markerSize - 3).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#222222">${p.b.wind}</text>
                <text x="${p.x.toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#555555">#${p.b.index}</text>
            `;
        });
    } else {
        html += `<text x="${padLeft + plotW / 2}" y="${padTop + plotH / 2}" text-anchor="middle" font-size="12" fill="#888888">Press Play to begin simulation</text>`;
    }

    svg.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Button listeners
// ---------------------------------------------------------------------------

btnPlay.addEventListener("click", () => {
    if (simRunning) {
        stopPlay();
    } else {
        startPlay();
    }
});

btnStep.addEventListener("click", () => {
    stopPlay();
    stepForward();
});

btnReset.addEventListener("click", () => {
    resetSim();
});

document.getElementById("btn-export-csv").addEventListener("click", () => {
    if (!latestAnalysis || latestAnalysis.bulletins.length === 0) return;
    const locality = document.getElementById("locality-input").value.trim() || "Unspecified";
    const headers  = ["Bulletin #", "Locality", "Date-Time", "Wind Speed (km/h)", "Signal", "Status", "PDA State"];
    const rows     = latestAnalysis.bulletins.map((b) => [
        b.index,
        `"${locality.replace(/"/g, '""')}"`,
        `"${b.datetime}"`,
        b.wind,
        `"${b.signal_label}"`,
        `"${statusDisplayText(b.status)}"`,
        b.pda_state,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "pagasa_signal_timeline.csv";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------
updateSimUI();
renderAll();