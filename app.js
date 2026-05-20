// SleepGuard - AI Sleep Detection System
(function () {
  "use strict";

  // Eye landmark indices for MediaPipe FaceMesh
  const LEFT_EYE = [33, 160, 158, 133, 153, 144];
  const RIGHT_EYE = [362, 385, 387, 263, 373, 380];
  const MOUTH = [13, 14, 78, 308];

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const state = {
    monitoring: false,
    cameraReady: false,
    faceMesh: null,
    camera: null,
    audioCtx: null,
    earHistory: [],
    earGraphData: [],
    blinkCount: 0,
    drowsyEpisodes: 0,
    sessionStart: null,
    sessionTimer: null,
    eyesClosedStart: null,
    alertActive: false,
    alarmOscillators: [],
    dismissCooldown: null,
    pipActive: false,
    pipCanvas: null,
    pipCtx: null,
    keepaliveInterval: null,
    wakeLock: null,
    workerTimerId: null,
    bgWorker: null,
    calibration: { openEAR: 0.28, closedEAR: 0.15, done: false },
    config: {
      earThreshold: 0.21,
      alertDelay: 3,
      alertVolume: 0.8,
      soundAlert: true,
      flashAlert: true,
      voiceAlert: true,
      vibrateAlert: true,
    },
    fps: { count: 0, last: Date.now(), value: 0 },
    lastEAR: 0.3,
    wasEyeClosed: false,
    perclosWindow: [],
  };

  // ── Initialization ──
  async function init() {
    updateProgress(10, "Loading MediaPipe Face Mesh...");
    try {
      state.faceMesh = new FaceMesh({
        locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
      });
      state.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      state.faceMesh.onResults(onFaceResults);
      updateProgress(50, "Warming up model...");
      // Warm up with a blank canvas
      const c = document.createElement("canvas");
      c.width = 10; c.height = 10;
      await state.faceMesh.send({ image: c });
      updateProgress(100, "Ready!");
      setTimeout(() => {
        $("#loading-screen").classList.add("hidden");
        $("#app").classList.remove("hidden");
        initUI();
        initEarGraph();
      }, 600);
    } catch (e) {
      updateProgress(0, "Error loading models: " + e.message);
      console.error(e);
    }
  }

  function updateProgress(pct, msg) {
    $("#progress-fill").style.width = pct + "%";
    $("#loading-status").textContent = msg;
  }

  // ── UI Setup ──
  function initUI() {
    // Camera
    $("#enable-camera-btn").addEventListener("click", startCamera);
    // Start/Stop
    $("#start-btn").addEventListener("click", toggleMonitoring);
    // Calibrate
    $("#calibrate-btn").addEventListener("click", startCalibration);
    // Test alert
    $("#test-alert-btn").addEventListener("click", () => triggerAlert(true));
    // Dismiss alert
    $("#dismiss-alert-btn").addEventListener("click", dismissAlert);
    // Settings
    $("#settings-btn").addEventListener("click", () => $("#settings-modal").classList.remove("hidden"));
    $("#close-settings-btn").addEventListener("click", () => $("#settings-modal").classList.add("hidden"));
    $("#settings-modal").addEventListener("click", (e) => {
      if (e.target === $("#settings-modal")) $("#settings-modal").classList.add("hidden");
    });
    // Settings sliders
    $("#ear-threshold").addEventListener("input", (e) => {
      state.config.earThreshold = parseFloat(e.target.value);
      $("#ear-threshold-val").textContent = e.target.value;
    });
    $("#alert-delay").addEventListener("input", (e) => {
      state.config.alertDelay = parseFloat(e.target.value);
      $("#alert-delay-val").textContent = e.target.value + "s";
    });
    $("#alert-volume").addEventListener("input", (e) => {
      state.config.alertVolume = parseInt(e.target.value) / 100;
      $("#alert-volume-val").textContent = e.target.value + "%";
    });
    $("#alert-sound-toggle").addEventListener("change", (e) => (state.config.soundAlert = e.target.checked));
    $("#alert-flash-toggle").addEventListener("change", (e) => (state.config.flashAlert = e.target.checked));
    $("#alert-voice-toggle").addEventListener("change", (e) => (state.config.voiceAlert = e.target.checked));
    $("#alert-vibrate-toggle").addEventListener("change", (e) => (state.config.vibrateAlert = e.target.checked));
    // Cancel calibration
    $("#cancel-calibration").addEventListener("click", () => $("#calibration-modal").classList.add("hidden"));
    // PiP
    $("#pip-btn").addEventListener("click", togglePiP);
    // Video drop zone
    setupVideoPlayer();
    // Populate cameras
    populateCameras();
    // Auto-start camera
    startCamera();
    // Request notification permission early
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  // ── Camera ──
  async function startCamera() {
    try {
      const sel = $("#camera-select");
      const constraints = { video: sel.value ? { deviceId: { exact: sel.value } } : { facingMode: "user", width: 640, height: 480 } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const webcam = $("#webcam");
      webcam.srcObject = stream;
      await webcam.play();
      const canvas = $("#face-canvas");
      canvas.width = webcam.videoWidth || 640;
      canvas.height = webcam.videoHeight || 480;
      $("#no-camera-msg").classList.add("hidden");
      state.cameraReady = true;
      state.camera = new Camera(webcam, {
        onFrame: async () => {
          if (state.monitoring && state.faceMesh) {
            await state.faceMesh.send({ image: webcam });
          }
        },
        width: 640,
        height: 480,
      });
      state.camera.start();
      // Also set up a Worker-based backup loop for when tab is in background
      setupBackgroundLoop();
      populateCameras();
    } catch (e) {
      console.error("Camera error:", e);
      $("#no-camera-msg").classList.remove("hidden");
    }
  }

  async function populateCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const sel = $("#camera-select");
      sel.innerHTML = "";
      devices.filter((d) => d.kind === "videoinput").forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `Camera ${i + 1}`;
        sel.appendChild(opt);
      });
      sel.addEventListener("change", () => { if (state.cameraReady) startCamera(); });
    } catch (e) { /* ignore */ }
  }

  // ── Monitoring Toggle ──
  function toggleMonitoring() {
    if (state.monitoring) {
      stopMonitoring();
    } else {
      startMonitoring();
    }
  }

  function startMonitoring() {
    if (!state.cameraReady) { startCamera(); return; }
    state.monitoring = true;
    state.sessionStart = Date.now();
    state.blinkCount = 0;
    state.drowsyEpisodes = 0;
    state.earHistory = [];
    state.perclosWindow = [];
    state.eyesClosedStart = null;
    $("#start-btn").textContent = "⏹ Stop Monitoring";
    $("#start-btn").classList.remove("btn-glow");
    setStatus("active", "Monitoring");
    state.sessionTimer = setInterval(updateSessionTime, 1000);
    $("#cam-overlay-info").classList.remove("hidden");
    // Start keepalive to prevent browser from throttling this tab
    startKeepalive();
    // Acquire wake lock
    acquireWakeLock();
  }

  function stopMonitoring() {
    state.monitoring = false;
    clearInterval(state.sessionTimer);
    $("#start-btn").textContent = "▶ Start Monitoring";
    $("#start-btn").classList.add("btn-glow");
    setStatus("idle", "Stopped");
    $("#cam-overlay-info").classList.add("hidden");
    dismissAlert();
    clearCanvas();
    stopKeepalive();
    releaseWakeLock();
    exitPiP();
  }

  function setStatus(level, text) {
    const b = $("#status-badge");
    b.className = "status-badge status-" + level;
    $("#status-text").textContent = text;
  }

  // ── Face Mesh Results ──
  function onFaceResults(results) {
    // FPS calc
    state.fps.count++;
    const now = Date.now();
    if (now - state.fps.last >= 1000) {
      state.fps.value = state.fps.count;
      state.fps.count = 0;
      state.fps.last = now;
      $("#cam-fps-display").textContent = "FPS: " + state.fps.value;
    }

    const canvas = $("#face-canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      $("#cam-ear-display").textContent = "No face";
      return;
    }

    const landmarks = results.multiFaceLandmarks[0];
    drawFaceMesh(ctx, landmarks, canvas.width, canvas.height);

    // Calculate EAR
    const leftEAR = calcEAR(landmarks, LEFT_EYE);
    const rightEAR = calcEAR(landmarks, RIGHT_EYE);
    const avgEAR = (leftEAR + rightEAR) / 2;

    // Update displays
    $("#left-ear-val").textContent = leftEAR.toFixed(2);
    $("#right-ear-val").textContent = rightEAR.toFixed(2);
    $("#avg-ear-val").textContent = avgEAR.toFixed(2);
    $("#cam-ear-display").textContent = "EAR: " + avgEAR.toFixed(2);

    // Blink detection
    const eyeClosed = avgEAR < state.config.earThreshold;
    if (state.wasEyeClosed && !eyeClosed) {
      state.blinkCount++;
      $("#stat-blinks").textContent = state.blinkCount;
    }
    state.wasEyeClosed = eyeClosed;

    // PERCLOS tracking
    const ts = Date.now();
    state.perclosWindow.push({ t: ts, closed: eyeClosed });
    const cutoff = ts - 60000;
    state.perclosWindow = state.perclosWindow.filter((p) => p.t >= cutoff);
    const closedCount = state.perclosWindow.filter((p) => p.closed).length;
    const perclos = state.perclosWindow.length > 0 ? Math.round((closedCount / state.perclosWindow.length) * 100) : 0;
    $("#stat-perclos").textContent = perclos + "%";

    // Blink rate
    if (state.sessionStart) {
      const mins = (Date.now() - state.sessionStart) / 60000;
      const rate = mins > 0 ? Math.round(state.blinkCount / mins) : 0;
      $("#stat-blinkrate").textContent = rate + "/m";
    }

    // Drowsiness scoring
    const drowsiness = calcDrowsiness(avgEAR, perclos);
    updateGauge(drowsiness);

    // EAR graph
    state.earGraphData.push(avgEAR);
    if (state.earGraphData.length > 300) state.earGraphData.shift();
    drawEarGraph();

    // Sleep detection
    if (eyeClosed) {
      if (!state.eyesClosedStart) state.eyesClosedStart = Date.now();
      const closedDuration = (Date.now() - state.eyesClosedStart) / 1000;
      if (closedDuration >= state.config.alertDelay && !state.alertActive && !state.dismissCooldown) {
        state.drowsyEpisodes++;
        $("#stat-drowsy").textContent = state.drowsyEpisodes;
        triggerAlert(false);
      }
      // Update status based on duration
      if (closedDuration > 1 && closedDuration < state.config.alertDelay) {
        setStatus("warning", "Eyes Closing...");
      }
    } else {
      state.eyesClosedStart = null;
      if (state.monitoring && !state.alertActive) {
        setStatus("active", "Monitoring");
      }
    }

    state.lastEAR = avgEAR;
  }

  // ── EAR Calculation ──
  function calcEAR(landmarks, indices) {
    const p = indices.map((i) => landmarks[i]);
    const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    const vertical1 = dist(p[1], p[5]);
    const vertical2 = dist(p[2], p[4]);
    const horizontal = dist(p[0], p[3]);
    return horizontal === 0 ? 0 : (vertical1 + vertical2) / (2 * horizontal);
  }

  function calcDrowsiness(ear, perclos) {
    let score = 0;
    // EAR component (0-50)
    const earRange = state.calibration.openEAR - state.calibration.closedEAR;
    const earNorm = earRange > 0 ? 1 - (ear - state.calibration.closedEAR) / earRange : 0;
    score += Math.max(0, Math.min(50, earNorm * 50));
    // PERCLOS component (0-50)
    score += Math.min(50, perclos * 0.625);
    return Math.round(Math.max(0, Math.min(100, score)));
  }

  // ── Drawing ──
  function drawFaceMesh(ctx, landmarks, w, h) {
    // Draw eye contours
    ctx.strokeStyle = "rgba(0, 212, 255, 0.6)";
    ctx.lineWidth = 1.5;
    drawEyeContour(ctx, landmarks, LEFT_EYE, w, h);
    drawEyeContour(ctx, landmarks, RIGHT_EYE, w, h);
    // Draw eye points
    const allEyeIdx = [...LEFT_EYE, ...RIGHT_EYE];
    allEyeIdx.forEach((i) => {
      const pt = landmarks[i];
      ctx.beginPath();
      ctx.arc(pt.x * w, pt.y * h, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "#00ff88";
      ctx.fill();
    });
    // Draw nose tip
    const nose = landmarks[1];
    ctx.beginPath();
    ctx.arc(nose.x * w, nose.y * h, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#ffaa00";
    ctx.fill();
  }

  function drawEyeContour(ctx, landmarks, indices, w, h) {
    ctx.beginPath();
    indices.forEach((idx, i) => {
      const pt = landmarks[idx];
      if (i === 0) ctx.moveTo(pt.x * w, pt.y * h);
      else ctx.lineTo(pt.x * w, pt.y * h);
    });
    ctx.closePath();
    ctx.stroke();
  }

  function clearCanvas() {
    const c = $("#face-canvas");
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
  }

  // ── Gauge ──
  function updateGauge(pct) {
    const circumference = 2 * Math.PI * 80;
    const offset = circumference - (pct / 100) * circumference;
    const fill = $("#gauge-fill");
    fill.style.strokeDashoffset = offset;
    // Color based on level
    let color;
    const badge = $("#drowsiness-badge");
    if (pct < 30) {
      color = "var(--success)";
      badge.className = "drowsiness-badge level-alert";
      badge.textContent = "Alert";
    } else if (pct < 65) {
      color = "var(--warning)";
      badge.className = "drowsiness-badge level-warn";
      badge.textContent = "Drowsy";
    } else {
      color = "var(--danger)";
      badge.className = "drowsiness-badge level-danger";
      badge.textContent = "Sleeping";
    }
    fill.style.stroke = color;
    const valEl = $("#drowsiness-pct");
    valEl.textContent = pct;
    valEl.style.color = color;
  }

  // ── EAR Graph ──
  let earGraphCanvas, earGraphCtx;
  function initEarGraph() {
    earGraphCanvas = $("#ear-graph");
    earGraphCtx = earGraphCanvas.getContext("2d");
    resizeGraph();
    window.addEventListener("resize", resizeGraph);
  }
  function resizeGraph() {
    const container = $("#graph-container");
    earGraphCanvas.width = container.clientWidth;
    earGraphCanvas.height = container.clientHeight;
  }
  function drawEarGraph() {
    if (!earGraphCtx) return;
    const w = earGraphCanvas.width;
    const h = earGraphCanvas.height;
    const data = state.earGraphData;
    earGraphCtx.clearRect(0, 0, w, h);
    if (data.length < 2) return;
    // Threshold line
    const threshY = h - (state.config.earThreshold / 0.45) * h;
    earGraphCtx.strokeStyle = "rgba(255, 51, 102, 0.3)";
    earGraphCtx.lineWidth = 1;
    earGraphCtx.setLineDash([4, 4]);
    earGraphCtx.beginPath();
    earGraphCtx.moveTo(0, threshY);
    earGraphCtx.lineTo(w, threshY);
    earGraphCtx.stroke();
    earGraphCtx.setLineDash([]);
    // EAR line
    earGraphCtx.beginPath();
    const step = w / 300;
    const startIdx = Math.max(0, data.length - 300);
    data.slice(startIdx).forEach((v, i) => {
      const x = i * step;
      const y = h - (v / 0.45) * h;
      if (i === 0) earGraphCtx.moveTo(x, y);
      else earGraphCtx.lineTo(x, y);
    });
    earGraphCtx.strokeStyle = "#00d4ff";
    earGraphCtx.lineWidth = 1.5;
    earGraphCtx.stroke();
    // Fill
    earGraphCtx.lineTo((data.length - startIdx - 1) * step, h);
    earGraphCtx.lineTo(0, h);
    earGraphCtx.closePath();
    const grad = earGraphCtx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(0, 212, 255, 0.15)");
    grad.addColorStop(1, "rgba(0, 212, 255, 0)");
    earGraphCtx.fillStyle = grad;
    earGraphCtx.fill();
  }

  // ── Session Timer ──
  function updateSessionTime() {
    if (!state.sessionStart) return;
    const elapsed = Math.floor((Date.now() - state.sessionStart) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
    const s = String(elapsed % 60).padStart(2, "0");
    $("#stat-session").textContent = `${h}:${m}:${s}`;
  }

  // ── Alert System ──
  function triggerAlert(isTest) {
    if (state.alertActive && !isTest) return;
    state.alertActive = true;
    // Pause video
    const player = $("#media-player");
    if (player && !player.paused) player.pause();
    // Show overlay
    if (state.config.flashAlert) $("#alert-overlay").classList.remove("hidden");
    setStatus("danger", "⚠ ALERT!");
    // Sound alarm
    if (state.config.soundAlert) playAlarm();
    // Voice
    if (state.config.voiceAlert) speakAlert();
    // Vibration
    if (state.config.vibrateAlert && navigator.vibrate) {
      navigator.vibrate([500, 200, 500, 200, 500, 200, 500]);
    }
    // Browser notification (works even when tab is in background / VLC is focused)
    sendBrowserNotification();
  }

  function dismissAlert() {
    state.alertActive = false;
    $("#alert-overlay").classList.add("hidden");
    stopAlarm();
    window.speechSynthesis && window.speechSynthesis.cancel();
    state.eyesClosedStart = null;
    // Cooldown: prevent re-triggering for 5 seconds after dismiss
    state.dismissCooldown = true;
    setTimeout(() => { state.dismissCooldown = false; }, 5000);
    if (state.monitoring) setStatus("active", "Monitoring");
  }

  function getAudioCtx() {
    if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (state.audioCtx.state === "suspended") state.audioCtx.resume();
    return state.audioCtx;
  }

  function playAlarm() {
    stopAlarm();
    const ctx = getAudioCtx();
    const vol = state.config.alertVolume;
    // Create alarm pattern - multiple oscillators
    const freqs = [440, 587, 880];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === 0 ? "square" : "sawtooth";
      osc.frequency.value = freq;
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      state.alarmOscillators.push({ osc, gain });
      // Pulsing volume
      function pulse() {
        if (!state.alertActive) return;
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(vol * 0.25, now + 0.1);
        gain.gain.linearRampToValueAtTime(0, now + 0.3);
        setTimeout(pulse, 400 + i * 100);
      }
      setTimeout(pulse, i * 130);
    });
  }

  function stopAlarm() {
    state.alarmOscillators.forEach(({ osc, gain }) => {
      try { gain.gain.value = 0; osc.stop(); } catch (e) { /* ok */ }
    });
    state.alarmOscillators = [];
  }

  function speakAlert() {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance("Wake up! You are falling asleep!");
    msg.rate = 1.1;
    msg.pitch = 1.2;
    msg.volume = state.config.alertVolume;
    window.speechSynthesis.speak(msg);
  }

  // ── Calibration ──
  function startCalibration() {
    if (!state.monitoring) { alert("Please start monitoring first."); return; }
    const modal = $("#calibration-modal");
    modal.classList.remove("hidden");
    runCalibrationStep1();
  }

  function runCalibrationStep1() {
    $("#calibration-instruction").textContent = "Keep your eyes WIDE OPEN and look at the camera";
    setCalStep(1);
    let earSamples = [];
    const collectInterval = setInterval(() => {
      earSamples.push(state.lastEAR);
    }, 100);
    animateCalTimer(3, () => {
      clearInterval(collectInterval);
      if (earSamples.length > 0) {
        state.calibration.openEAR = earSamples.reduce((a, b) => a + b) / earSamples.length;
      }
      runCalibrationStep2();
    });
  }

  function runCalibrationStep2() {
    $("#calibration-instruction").textContent = "Now CLOSE your eyes gently";
    setCalStep(2);
    let earSamples = [];
    const collectInterval = setInterval(() => {
      earSamples.push(state.lastEAR);
    }, 100);
    animateCalTimer(3, () => {
      clearInterval(collectInterval);
      if (earSamples.length > 0) {
        state.calibration.closedEAR = earSamples.reduce((a, b) => a + b) / earSamples.length;
      }
      // Calculate optimal threshold
      const threshold = (state.calibration.openEAR + state.calibration.closedEAR) / 2;
      state.config.earThreshold = Math.round(threshold * 100) / 100;
      $("#ear-threshold").value = state.config.earThreshold;
      $("#ear-threshold-val").textContent = state.config.earThreshold.toFixed(2);
      state.calibration.done = true;
      finishCalibration();
    });
  }

  function finishCalibration() {
    setCalStep(3);
    $("#calibration-instruction").textContent =
      `Calibrated! Threshold set to ${state.config.earThreshold.toFixed(2)} (Open: ${state.calibration.openEAR.toFixed(2)}, Closed: ${state.calibration.closedEAR.toFixed(2)})`;
    setTimeout(() => { $("#calibration-modal").classList.add("hidden"); }, 2500);
  }

  function setCalStep(step) {
    for (let i = 1; i <= 3; i++) {
      const el = $(`#cal-step-${i}`);
      el.classList.remove("active", "done");
      if (i < step) el.classList.add("done");
      if (i === step) el.classList.add("active");
    }
  }

  function animateCalTimer(seconds, cb) {
    const fill = $("#cal-timer-fill");
    const text = $("#cal-timer-text");
    const circ = 2 * Math.PI * 40;
    let remaining = seconds;
    text.textContent = remaining;
    fill.style.strokeDashoffset = circ;
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed++;
      remaining = seconds - elapsed;
      text.textContent = Math.max(0, remaining);
      fill.style.strokeDashoffset = circ - (elapsed / seconds) * circ;
      if (elapsed >= seconds) {
        clearInterval(interval);
        cb();
      }
    }, 1000);
  }

  // ── Video Player ──
  function setupVideoPlayer() {
    const dropZone = $("#drop-zone");
    const fileInput = $("#file-input");
    const player = $("#media-player");
    const clearBtn = $("#clear-video-btn");
    const browseBtn = $("#browse-btn");

    browseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput.click();
    });
    dropZone.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) loadVideo(e.target.files[0]);
    });

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
      if (e.dataTransfer.files.length > 0) loadVideo(e.dataTransfer.files[0]);
    });

    clearBtn.addEventListener("click", () => {
      player.classList.add("hidden");
      player.src = "";
      dropZone.classList.remove("hidden");
      clearBtn.classList.add("hidden");
    });
  }

  function loadVideo(file) {
    const player = $("#media-player");
    player.src = URL.createObjectURL(file);
    player.classList.remove("hidden");
    $("#drop-zone").classList.add("hidden");
    $("#clear-video-btn").classList.remove("hidden");
    player.play().catch(() => {});
  }

  // ── Start ──
  window.addEventListener("DOMContentLoaded", init);

  // ═══════════════════════════════════════
  // Background Keepalive & PiP System
  // ═══════════════════════════════════════

  // -- Silent audio keepalive --
  // Browsers won't fully throttle tabs that are playing audio
  function startKeepalive() {
    stopKeepalive();
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 1; // inaudible
      gain.gain.value = 0.001; // nearly silent
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      state.keepaliveOsc = { osc, gain };
    } catch (e) { console.warn("Keepalive audio failed:", e); }
  }

  function stopKeepalive() {
    if (state.keepaliveOsc) {
      try { state.keepaliveOsc.osc.stop(); } catch (e) { /* ok */ }
      state.keepaliveOsc = null;
    }
  }

  // -- Background Worker loop --
  // Web Workers are NOT throttled when tab is in background
  function setupBackgroundLoop() {
    if (state.bgWorker) return;
    const code = `
      let interval = null;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          if (interval) clearInterval(interval);
          interval = setInterval(() => self.postMessage('tick'), 100);
        } else if (e.data === 'stop') {
          if (interval) clearInterval(interval);
          interval = null;
        }
      };
    `;
    const blob = new Blob([code], { type: "application/javascript" });
    state.bgWorker = new Worker(URL.createObjectURL(blob));
    state.bgWorker.onmessage = async () => {
      // Only run background inference when tab is hidden and monitoring
      if (!document.hidden || !state.monitoring || !state.faceMesh) return;
      try {
        const webcam = $("#webcam");
        if (webcam.readyState >= 2) {
          await state.faceMesh.send({ image: webcam });
        }
      } catch (e) { /* ignore frame errors */ }
    };
    state.bgWorker.postMessage("start");
  }

  // -- Screen Wake Lock --
  async function acquireWakeLock() {
    if ("wakeLock" in navigator) {
      try {
        state.wakeLock = await navigator.wakeLock.request("screen");
        state.wakeLock.addEventListener("release", () => { state.wakeLock = null; });
      } catch (e) { console.warn("Wake lock failed:", e); }
    }
  }

  function releaseWakeLock() {
    if (state.wakeLock) {
      state.wakeLock.release().catch(() => {});
      state.wakeLock = null;
    }
  }

  // Re-acquire wake lock when tab becomes visible again
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.monitoring) {
      acquireWakeLock();
    }
  });

  // -- Browser Notifications --
  function sendBrowserNotification() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
      const n = new Notification("⚠️ SleepGuard — WAKE UP!", {
        body: "You appear to be falling asleep! Click to return.",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚠️</text></svg>",
        requireInteraction: true,
        tag: "sleepguard-alert",
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch (e) { /* ignore */ }
  }

  // -- Picture-in-Picture --
  // Renders webcam + face mesh + EAR info onto a canvas, streams it to a PiP video
  function togglePiP() {
    if (state.pipActive) {
      exitPiP();
    } else {
      enterPiP();
    }
  }

  async function enterPiP() {
    if (!state.cameraReady) { alert("Please enable the camera first."); return; }
    // Create a canvas to composite webcam + overlay
    if (!state.pipCanvas) {
      state.pipCanvas = document.createElement("canvas");
      state.pipCanvas.width = 320;
      state.pipCanvas.height = 240;
      state.pipCtx = state.pipCanvas.getContext("2d");
    }
    // Start drawing loop
    state.pipActive = true;
    drawPiPFrame();
    // Stream canvas to pip video
    const pipVideo = $("#pip-video");
    const stream = state.pipCanvas.captureStream(15);
    pipVideo.srcObject = stream;
    pipVideo.muted = true;
    await pipVideo.play();
    try {
      await pipVideo.requestPictureInPicture();
      $("#pip-btn").textContent = "🖼️ Exit Float";
      pipVideo.addEventListener("leavepictureinpicture", onPiPExit, { once: true });
    } catch (e) {
      console.error("PiP failed:", e);
      alert("Picture-in-Picture is not supported in this browser. Try Chrome.");
      state.pipActive = false;
    }
  }

  function drawPiPFrame() {
    if (!state.pipActive) return;
    const ctx = state.pipCtx;
    const w = state.pipCanvas.width;
    const h = state.pipCanvas.height;
    const webcam = $("#webcam");
    // Draw webcam (mirrored)
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(webcam, 0, 0, w, h);
    ctx.restore();
    // Draw EAR + status text
    const ear = state.lastEAR;
    const isClosed = ear < state.config.earThreshold;
    ctx.fillStyle = isClosed ? "rgba(255,51,102,0.7)" : "rgba(0,255,136,0.7)";
    ctx.fillRect(0, 0, w, 28);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px Inter, sans-serif";
    ctx.fillText(`EAR: ${ear.toFixed(2)}  |  ${isClosed ? '⚠️ EYES CLOSED' : '✅ AWAKE'}`, 8, 19);
    // If alert active, show big warning
    if (state.alertActive) {
      ctx.fillStyle = "rgba(255,0,0,0.5)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 32px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("WAKE UP!", w / 2, h / 2);
      ctx.textAlign = "start";
    }
    requestAnimationFrame(drawPiPFrame);
  }

  function exitPiP() {
    state.pipActive = false;
    $("#pip-btn").textContent = "🖼️ Float Over VLC";
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
    const pipVideo = $("#pip-video");
    if (pipVideo.srcObject) {
      pipVideo.srcObject.getTracks().forEach((t) => t.stop());
      pipVideo.srcObject = null;
    }
  }

  function onPiPExit() {
    state.pipActive = false;
    $("#pip-btn").textContent = "🖼️ Float Over VLC";
  }

})();
