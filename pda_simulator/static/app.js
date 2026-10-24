/**
 * Front-end controller for Program 1: PAGASA Wind Signal PDA Simulator.
 * Handles playback, SVG state/edge highlighting, stack animations, input tape, and log navigation.
 */

const STACK_SYMBOL_LABELS = {
    "Z0": "Z0 = bottom",
    "0": "0 = No signal",
    "1": "1 = Signal 1",
    "2": "2 = Signal 2",
    "3": "3 = Signal 3",
    "4": "4 = Signal 4",
    "5": "5 = Signal 5"
};

const STATE_SIGNAL_INFO = {
    "q0": { text: "q0 — Idle / Finished (No signal)", css: "signal-idle", icon: "◆" },
    "q1": { text: "q1 — Transition Hub", css: "signal-hub", icon: "◇" },
    "q2": { text: "q2 — No signal (0–38 km/h)", css: "signal-0", icon: "○" },
    "q3": { text: "q3 — Signal 1 (39–61 km/h)", css: "signal-1", icon: "▲" },
    "q4": { text: "q4 — Signal 2 (62–88 km/h)", css: "signal-2", icon: "▲▲" },
    "q5": { text: "q5 — Signal 3 (89–117 km/h)", css: "signal-3", icon: "▲▲▲" },
    "q6": { text: "q6 — Signal 4 (118–184 km/h)", css: "signal-4", icon: "★" },
    "q7": { text: "q7 — Signal 5 (≥185 km/h)", css: "signal-5", icon: "★★" }
};

const ALL_STATES = ["q0", "q1", "q2", "q3", "q4", "q5", "q6", "q7"];

let simData = null;       // Response from /api/run
let currentStepIndex = 0; // 0 = initial state before any transition; 1..N = after step k
let playTimer = null;

// DOM Elements
const readingsInput = document.getElementById("readingsInput");
const runBtn = document.getElementById("runBtn");
const validationAlert = document.getElementById("validationAlert");
const emptyNote = document.getElementById("emptyNote");
const inputTapeEl = document.getElementById("inputTape");
const tapeProgressEl = document.getElementById("tapeProgress");
const resultBanner = document.getElementById("resultBanner");
const bannerStatus = document.getElementById("bannerStatus");
const bannerReason = document.getElementById("bannerReason");
const stepCounter = document.getElementById("stepCounter");
const stepDescription = document.getElementById("stepDescription");
const signalBadge = document.getElementById("signalBadge");
const badgeIcon = document.getElementById("badgeIcon");
const badgeStateText = document.getElementById("badgeStateText");
const stackContainer = document.getElementById("stackContainer");
const stackActionBadge = document.getElementById("stackActionBadge");
const logTableBody = document.getElementById("logTableBody");
const logSummary = document.getElementById("logSummary");

const resetBtn = document.getElementById("resetBtn");
const backBtn = document.getElementById("backBtn");
const playPauseBtn = document.getElementById("playPauseBtn");
const stepBtn = document.getElementById("stepBtn");
const speedSlider = document.getElementById("speedSlider");
const speedValue = document.getElementById("speedValue");

/**
 * Send current input string to the Python Flask backend and initialize step 0.
 */
async function runSimulation() {
    stopPlayback();
    hideAlerts();

    const rawInput = readingsInput.value;
    try {
        const response = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input: rawInput })
        });

        const data = await response.json();
        if (!response.ok || data.validation_error) {
            showValidationError(data.reason || "Invalid input.");
            return;
        }

        simData = data;
        currentStepIndex = 0;

        if (simData.empty_input) {
            emptyNote.textContent =
                "Note: Empty input is accepted immediately in 0 steps because q0 is both the initial and accepting state (stack remains empty).";
            emptyNote.classList.remove("hidden");
        }

        buildLogTable();
        renderCurrentStep();
    } catch (err) {
        showValidationError("Failed to communicate with local Flask server: " + err.message);
    }
}

function hideAlerts() {
    validationAlert.classList.add("hidden");
    validationAlert.textContent = "";
    emptyNote.classList.add("hidden");
    emptyNote.textContent = "";
    resultBanner.classList.add("hidden");
}

function showValidationError(msg) {
    validationAlert.textContent = msg;
    validationAlert.classList.remove("hidden");
}

/**
 * Populate the transition log table with all steps from simData.
 */
function buildLogTable() {
    logTableBody.innerHTML = "";
    const steps = simData ? simData.steps : [];
    logSummary.textContent = `${steps.length} transition${steps.length === 1 ? "" : "s"}`;

    if (steps.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 8;
        td.style.textAlign = "center";
        td.style.color = "#64748b";
        td.textContent = "0 transitions executed (initial configuration q0).";
        tr.appendChild(td);
        logTableBody.appendChild(tr);
        return;
    }

    const tapeValues = simData.tape.map((item) => item.value);

    steps.forEach((stepObj, idx) => {
        const tr = document.createElement("tr");
        tr.dataset.stepIndex = String(idx + 1);

        const stackStr =
            stepObj.stack_after.length > 0 ? stepObj.stack_after.join(" ") : "ε (empty)";
        const remainingSlice = tapeValues.slice(stepObj.input_pos_after);
        const remainingStr =
            remainingSlice.length > 0 ? remainingSlice.join(", ") : "ε (none)";

        tr.innerHTML = `
      <td>${stepObj.step}</td>
      <td><strong>${stepObj.transition_id}</strong></td>
      <td>${stepObj.from_state} → ${stepObj.to_state}</td>
      <td>${stepObj.read === "ε" ? "ε" : stepObj.read + " km/h"}</td>
      <td>${stepObj.pop}</td>
      <td>${stepObj.push}</td>
      <td>[${stackStr}]</td>
      <td>${remainingStr}</td>
    `;

        tr.addEventListener("click", () => {
            stopPlayback();
            currentStepIndex = idx + 1;
            renderCurrentStep();
        });

        logTableBody.appendChild(tr);
    });
}

/**
 * Render the entire UI for currentStepIndex (0 .. simData.steps.length).
 */
function renderCurrentStep() {
    if (!simData) return;

    const steps = simData.steps;
    const totalSteps = steps.length;

    // Determine current configuration at currentStepIndex
    let curState = "q0";
    let curStack = [];
    let curInputPos = 0;
    let activeStep = null;

    const visitedStates = new Set(["q0"]);
    for (let i = 0; i < currentStepIndex; i++) {
        visitedStates.add(steps[i].from_state);
        visitedStates.add(steps[i].to_state);
    }

    if (currentStepIndex > 0) {
        activeStep = steps[currentStepIndex - 1];
        curState = activeStep.to_state;
        curStack = activeStep.stack_after;
        curInputPos = activeStep.input_pos_after;
    }

    // 1. Update step counter & description
    stepCounter.textContent = `Step ${currentStepIndex} / ${totalSteps}`;
    if (currentStepIndex === 0) {
        stepDescription.textContent = "Initial configuration: state q0, stack empty (ε).";
    } else {
        const readText =
            activeStep.read === "ε" ? "ε (no input read)" : `${activeStep.read} km/h`;
        stepDescription.textContent = `${activeStep.transition_id}: ${activeStep.from_state} → ${activeStep.to_state} | read ${readText}, pop ${activeStep.pop}, push ${activeStep.push}`;
    }

    // 2. Update PAGASA Signal Badge
    const badgeMeta = STATE_SIGNAL_INFO[curState] || STATE_SIGNAL_INFO["q0"];
    signalBadge.className = `signal-badge ${badgeMeta.css}`;
    badgeIcon.textContent = badgeMeta.icon;
    badgeStateText.textContent = badgeMeta.text;

    // 3. Update SVG states & edges
    updateSvgDiagram(curState, visitedStates, activeStep ? activeStep.transition_id : null);

    // 4. Update Vertical Stack Panel
    updateStackPanel(curStack, activeStep);

    // 5. Update Input Tape
    updateInputTape(curInputPos);

    // 6. Highlight active row in Transition Log and auto-scroll
    highlightLogRow(currentStepIndex);

    // 7. Update Transport Buttons
    resetBtn.disabled = currentStepIndex === 0;
    backBtn.disabled = currentStepIndex === 0;
    stepBtn.disabled = currentStepIndex >= totalSteps;

    // 8. Result banner shown ONLY after the final step
    if (currentStepIndex === totalSteps) {
        resultBanner.classList.remove("hidden", "banner-accepted", "banner-rejected");
        if (simData.accepted) {
            resultBanner.classList.add("banner-accepted");
            bannerStatus.textContent = "✓ ACCEPTED";
            bannerReason.textContent = simData.empty_input
                ? simData.reason
                : "storm signals fully lifted, stack empty, ended in q0";
        } else {
            resultBanner.classList.add("banner-rejected");
            bannerStatus.textContent = "✕ REJECTED";
            bannerReason.textContent = simData.reason;
        }
    } else {
        resultBanner.classList.add("hidden");
    }
}

/**
 * Highlight current state, tint visited states, and glow/animate active edge.
 */
function updateSvgDiagram(curState, visitedStates, activeTransitionId) {
    ALL_STATES.forEach((st) => {
        const el = document.getElementById(`state-${st}`);
        if (!el) return;
        el.classList.remove("state-current", "state-visited");
        if (st === curState) {
            el.classList.add("state-current");
        } else if (visitedStates.has(st)) {
            el.classList.add("state-visited");
        }
    });

    // Reset all edges
    document.querySelectorAll(".pda-edge").forEach((edgeEl) => {
        edgeEl.classList.remove("edge-active");
        const pathEl = edgeEl.querySelector(".edge-line");
        if (pathEl) {
            pathEl.setAttribute("marker-end", "url(#arrow)");
        }
    });

    if (activeTransitionId) {
        const activeEdgeEl = document.getElementById(`edge-${activeTransitionId}`);
        if (activeEdgeEl) {
            activeEdgeEl.classList.add("edge-active");
            const pathEl = activeEdgeEl.querySelector(".edge-line");
            if (pathEl) {
                pathEl.setAttribute("marker-end", "url(#arrow-active)");
            }
        }
    }
}

/**
 * Render vertical stack with top of stack at the top.
 */
function updateStackPanel(stackBottomToTop, activeStep) {
    if (!activeStep) {
        stackActionBadge.textContent = "Initial (ε)";
    } else if (activeStep.push !== "ε" && activeStep.pop === "ε") {
        stackActionBadge.textContent = `Pushed ${activeStep.push}`;
    } else if (activeStep.pop !== "ε" && activeStep.push === "ε") {
        stackActionBadge.textContent = `Popped ${activeStep.pop}`;
    } else {
        stackActionBadge.textContent = "No change (ε → ε)";
    }

    stackContainer.innerHTML = "";
    if (stackBottomToTop.length === 0) {
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "stack-empty-placeholder";
        emptyDiv.textContent = "Stack Empty (ε)";
        stackContainer.appendChild(emptyDiv);
        return;
    }

    // Render from top to bottom
    const topToBottom = [...stackBottomToTop].reverse();
    topToBottom.forEach((sym, idx) => {
        const item = document.createElement("div");
        item.className = "stack-item";
        if (idx === 0) {
            item.classList.add("stack-top");
            if (activeStep && activeStep.push !== "ε") {
                item.classList.add("anim-push");
            }
        }

        const meaning = STACK_SYMBOL_LABELS[sym] || sym;
        const roleTag = idx === 0 ? "TOP" : idx === topToBottom.length - 1 ? "BOTTOM" : "";

        item.innerHTML = `
      <span>${meaning}</span>
      <span style="font-size:0.72rem; color:#475569;">${roleTag}</span>
    `;
        stackContainer.appendChild(item);
    });
}

/**
 * Render input tape chips styled as consumed / current / pending using shapes, labels, and color.
 */
function updateInputTape(consumedCount) {
    inputTapeEl.innerHTML = "";
    const tape = simData ? simData.tape : [];
    tapeProgressEl.textContent = `${consumedCount} / ${tape.length} consumed`;

    if (tape.length === 0) {
        const emptyChip = document.createElement("div");
        emptyChip.className = "tape-chip chip-consumed";
        emptyChip.innerHTML = `
      <span class="chip-status">✓ EMPTY TAPE</span>
      <span class="chip-val">ε</span>
      <span class="chip-band">0 readings</span>
    `;
        inputTapeEl.appendChild(emptyChip);
        return;
    }

    tape.forEach((item, idx) => {
        const chip = document.createElement("div");
        chip.setAttribute("role", "listitem");

        let statusClass = "chip-pending";
        let statusLabel = "○ Pending";

        if (idx < consumedCount) {
            statusClass = "chip-consumed";
            statusLabel = "✓ Consumed";
        } else if (idx === consumedCount) {
            statusClass = "chip-current";
            statusLabel = "▶ Next / Current";
        }

        chip.className = `tape-chip ${statusClass}`;
        chip.innerHTML = `
      <span class="chip-status">${statusLabel}</span>
      <span class="chip-val">${item.value} km/h</span>
      <span class="chip-band">${item.band_name} (${item.band})</span>
    `;
        inputTapeEl.appendChild(chip);
    });
}

/**
 * Highlight active row in log table and scroll it into view.
 */
function highlightLogRow(stepIdx) {
    const rows = logTableBody.querySelectorAll("tr");
    rows.forEach((row) => {
        if (Number(row.dataset.stepIndex) === stepIdx) {
            row.classList.add("log-row-active");
            row.scrollIntoView({ block: "nearest", behavior: "smooth" });
        } else {
            row.classList.remove("log-row-active");
        }
    });
}

/**
 * Playback controls
 */
function stepForward() {
    if (!simData) return;
    if (currentStepIndex < simData.steps.length) {
        currentStepIndex++;
        renderCurrentStep();
    } else {
        stopPlayback();
    }
}

function stepBackward() {
    if (!simData) return;
    if (currentStepIndex > 0) {
        currentStepIndex--;
        renderCurrentStep();
    }
}

function togglePlayPause() {
    if (!simData) return;
    if (playTimer !== null) {
        stopPlayback();
        return;
    }

    // If already at the end, restart from step 0 when Play is pressed
    if (currentStepIndex >= simData.steps.length) {
        currentStepIndex = 0;
        renderCurrentStep();
    }

    playPauseBtn.textContent = "⏸ Pause";
    const intervalMs = Number(speedSlider.value);
    playTimer = setInterval(() => {
        if (currentStepIndex < simData.steps.length) {
            stepForward();
        }
        if (currentStepIndex >= simData.steps.length) {
            stopPlayback();
        }
    }, intervalMs);
}

function stopPlayback() {
    if (playTimer !== null) {
        clearInterval(playTimer);
        playTimer = null;
    }
    playPauseBtn.textContent = "▶ Play";
}

// Event Listeners
runBtn.addEventListener("click", runSimulation);

readingsInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        runSimulation();
    }
});

document.querySelectorAll(".btn-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
        readingsInput.value = btn.dataset.preset;
        runSimulation();
    });
});

resetBtn.addEventListener("click", () => {
    stopPlayback();
    currentStepIndex = 0;
    renderCurrentStep();
});

backBtn.addEventListener("click", () => {
    stopPlayback();
    stepBackward();
});

stepBtn.addEventListener("click", () => {
    stopPlayback();
    stepForward();
});

playPauseBtn.addEventListener("click", togglePlayPause);

speedSlider.addEventListener("input", () => {
    speedValue.textContent = `${speedSlider.value} ms/step`;
    if (playTimer !== null) {
        stopPlayback();
        togglePlayPause();
    }
});

// Keyboard shortcuts: Right arrow = step, Left arrow = back, Space = play/pause
window.addEventListener("keydown", (e) => {
    const activeTag = document.activeElement ? document.activeElement.tagName : "";
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") {
        return;
    }

    if (e.key === "ArrowRight") {
        e.preventDefault();
        stopPlayback();
        stepForward();
    } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        stopPlayback();
        stepBackward();
    } else if (e.key === " ") {
        e.preventDefault();
        togglePlayPause();
    }
});

// Run initial preset on page load
window.addEventListener("DOMContentLoaded", () => {
    runSimulation();
});