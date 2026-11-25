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
    currentMode: "movie", // "movie" | "code" | "creative" | "study" | "health"
    posture: {
      baselineY: null,
      baselineDist: null,
      baselinePitchRatio: null,
      baselineVertDist: null,
      calibrated: false,
      status: "good", // "good" | "slouch" | "close" | "tilt"
      slouchFrames: 0,
      closeFrames: 0,
      lastWarning: 0,
    },
    nodding: {
      isNodding: false,
      nodFrames: 0,
      nodStartTime: null,
      lastAlert: 0,
    },
    study: {
      bookmarks: [],
    },
    eyeBreak: {
      intervalSec: 20 * 60, // 20 minutes
      remainingSec: 20 * 60,
      timerId: null,
      modalTimerId: null,
      active: false,
    },
    config: {
      earThreshold: 0.21,
      alertDelay: 3,
      alertVolume: 0.8,
      soundAlert: true,
      flashAlert: true,
      voiceAlert: true,
      vibrateAlert: true,
      soundStyle: "auto", // "auto" | "siren" | "binaural" | "gentle"
      nodDetection: true,
      postureDetection: true,
      breakReminder: true,
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
    // New Settings
    const soundStyleSel = $("#alert-sound-style");
    if (soundStyleSel) soundStyleSel.addEventListener("change", (e) => (state.config.soundStyle = e.target.value));
    const nodToggle = $("#feature-nod-toggle");
    if (nodToggle) nodToggle.addEventListener("change", (e) => (state.config.nodDetection = e.target.checked));
    const postureToggle = $("#feature-posture-toggle");
    if (postureToggle) postureToggle.addEventListener("change", (e) => (state.config.postureDetection = e.target.checked));
    const breakToggle = $("#feature-break-toggle");
    if (breakToggle) breakToggle.addEventListener("change", (e) => (state.config.breakReminder = e.target.checked));

    // Mode tabs
    $$(".mode-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchMode(tab.dataset.mode));
    });

    // Posture recalibration
    const recalPostureBtn = $("#recalibrate-posture-btn");
    if (recalPostureBtn) recalPostureBtn.addEventListener("click", () => calibratePosture(true));

    // Study Bookmarks
    const addBookmarkBtn = $("#add-manual-bookmark-btn");
    if (addBookmarkBtn) addBookmarkBtn.addEventListener("click", () => addStudyBookmark("Manual Bookmark"));

    // 20-20-20 Eye Break
    const triggerBreakBtn = $("#trigger-break-now-btn");
    if (triggerBreakBtn) triggerBreakBtn.addEventListener("click", triggerEyeBreak);
    const dismissBreakBtn = $("#dismiss-break-btn");
    if (dismissBreakBtn) dismissBreakBtn.addEventListener("click", dismissEyeBreak);

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
    // Reset posture & start eye break timer
    state.posture.calibrated = false;
    startBreakTimer();
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
    stopBreakTimer();
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

    // Process Posture, Head Nodding & Flow state
    processPostureAndNodding(landmarks, avgEAR, perclos);
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
  function triggerAlert(isTest, reason) {
    if (state.alertActive && !isTest) return;
    state.alertActive = true;
    const alertReason = reason || "sleep";

    // Pause video
    const player = $("#media-player");
    if (player && !player.paused) {
      player.pause();
      // If Study Mode, automatically save a lecture bookmark
      if (state.currentMode === "study") {
        addStudyBookmark(alertReason === "nodding" ? "Nodded off in lecture" : "Eyes closed in lecture");
      }
    }

    // Configure overlay text according to alert reason & mode
    const alertTitle = $("#alert-overlay .alert-title");
    const alertSub = $("#alert-overlay .alert-subtitle");
    if (alertReason === "nodding") {
      alertTitle.textContent = "HEAD DROOPING!";
      alertSub.textContent = "Microsleep or head nodding detected";
    } else if (alertReason === "slouch") {
      alertTitle.textContent = "CHECK POSTURE!";
      alertSub.textContent = "Slouching or screen proximity detected";
    } else {
      alertTitle.textContent = "WAKE UP!";
      alertSub.textContent = "You appear to be falling asleep";
    }

    // Show overlay
    if (state.config.flashAlert) $("#alert-overlay").classList.remove("hidden");
    setStatus("danger", "⚠ ALERT!");

    // Sound alert selection
    if (state.config.soundAlert) {
      let style = state.config.soundStyle;
      if (style === "auto") {
        if (state.currentMode === "code" || state.currentMode === "creative") style = "binaural";
        else if (state.currentMode === "study" || state.currentMode === "health") style = "gentle";
        else style = "siren";
      }

      if (style === "binaural") playBinauralChime();
      else if (style === "gentle") playPostureChime();
      else playAlarm();
    }

    // Voice
    if (state.config.voiceAlert) speakAlert(alertReason);

    // Vibration
    if (state.config.vibrateAlert && navigator.vibrate) {
      navigator.vibrate([500, 200, 500, 200, 500, 200, 500]);
    }

    // Browser notification (works even when tab is in background / VLC is focused)
    sendBrowserNotification(alertReason);
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

  function playBinauralChime() {
    stopAlarm();
    const ctx = getAudioCtx();
    const vol = state.config.alertVolume;
    // C-major 9th harmonic chord: C4 (261.6), E4 (329.6), G4 (392.0), B4 (493.9), D5 (587.3)
    const chord = [261.63, 329.63, 392.0, 493.88, 587.33];
    chord.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const now = ctx.currentTime + idx * 0.08;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol * 0.18, now + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 2.3);
      state.alarmOscillators.push({ osc, gain });
    });
  }

  function playPostureChime() {
    stopAlarm();
    const ctx = getAudioCtx();
    const vol = state.config.alertVolume;
    // Pleasant two-tone marimba chime (C5 -> G5)
    [523.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const now = ctx.currentTime + idx * 0.14;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol * 0.22, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 1.3);
      state.alarmOscillators.push({ osc, gain });
    });
  }

  function speakAlert(reason) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    let text = "Wake up! You are falling asleep!";
    if (reason === "nodding") {
      text = state.currentMode === "code"
        ? "Keep your head up, developer! Microsleep detected."
        : "Keep your head up! Stay alert.";
    } else if (reason === "slouch") {
      text = "Check your posture! Sit upright.";
    } else if (state.currentMode === "study") {
      text = "Stay focused! You can do this. Lecture bookmarked.";
    }

    const msg = new SpeechSynthesisUtterance(text);
    msg.rate = 1.05;
    msg.pitch = 1.1;
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

  // ═══════════════════════════════════════
  // Mode Switcher, Posture, Nodding & Health Modules
  // ═══════════════════════════════════════

  const MODE_METADATA = {
    movie: {
      hint: "Watching movies/shows with deep sleep alarm & VLC float",
      delay: 3.0,
      soundStyle: "siren",
      note: "💡 You can also watch in VLC, Netflix, or any player — SleepGuard monitors independently",
      panels: []
    },
    code: {
      hint: "Coding & Dev: Head nod detection, fatigue tracking & harmonic bell",
      delay: 2.5,
      soundStyle: "binaural",
      note: "💻 DevGuard active: Head nodding, blink rate, and fatigue monitoring running in background",
      panels: ["flow-panel"]
    },
    creative: {
      hint: "Creative Studio: Gentle lo-fi chimes & flow-state tracking",
      delay: 2.5,
      soundStyle: "binaural",
      note: "🎨 Creative Mode: Tracks focus zones during rendering & timeline editing",
      panels: ["flow-panel"]
    },
    study: {
      hint: "Smart Study: Fast 1.8s sleep response, motivational voice & lecture bookmarks",
      delay: 1.8,
      soundStyle: "gentle",
      note: "📚 StudyGuard active: Auto-pauses lectures and bookmarks timestamp when you nod off",
      panels: ["study-panel"]
    },
    health: {
      hint: "Desk Health: Spine posture & 20-20-20 eye strain break reminder",
      delay: 3.0,
      soundStyle: "gentle",
      note: "🧘 Posture & Eye Guardian: Keeps your spine straight & prevents digital eye strain",
      panels: ["health-panel"]
    }
  };

  function switchMode(mode) {
    if (!MODE_METADATA[mode]) return;
    state.currentMode = mode;

    // Update tab classes
    $$(".mode-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.mode === mode);
    });

    const meta = MODE_METADATA[mode];
    const hintEl = $("#mode-badge-hint");
    if (hintEl) hintEl.textContent = meta.hint;
    const noteEl = $("#panel-note-text");
    if (noteEl) noteEl.textContent = meta.note;

    // Apply mode default delay
    state.config.alertDelay = meta.delay;
    const delaySlider = $("#alert-delay");
    if (delaySlider) delaySlider.value = meta.delay;
    const delayVal = $("#alert-delay-val");
    if (delayVal) delayVal.textContent = meta.delay.toFixed(1) + "s";

    // Toggle panels
    ["study-panel", "health-panel", "flow-panel"].forEach((id) => {
      const el = $(`#${id}`);
      if (el) el.classList.toggle("hidden", !meta.panels.includes(id));
    });

    playPostureChime();
  }

  function calibratePosture(manual) {
    if (!state.lastLandmarks) return;
    const lm = state.lastLandmarks;
    // Landmark 10 (forehead), 1 (nose tip), 152 (chin), 234 (left cheek), 454 (right cheek)
    state.posture.baselineY = lm[1].y;
    state.posture.baselineDist = Math.hypot(lm[454].x - lm[234].x, lm[454].y - lm[234].y);
    const topDist = Math.abs(lm[1].y - lm[10].y);
    const botDist = Math.abs(lm[152].y - lm[1].y);
    state.posture.baselinePitchRatio = botDist > 0.005 ? topDist / botDist : 1.0;
    state.posture.baselineVertDist = Math.abs(lm[152].y - lm[10].y);
    state.posture.calibrated = true;
    if (manual) {
      playPostureChime();
      setStatus("active", "Posture Calibrated!");
      setTimeout(() => { if (state.monitoring) setStatus("active", "Monitoring"); }, 1500);
    }
  }

  function processPostureAndNodding(landmarks, avgEAR, perclos) {
    state.lastLandmarks = landmarks;
    if (!state.monitoring) return;

    // Auto-calibrate baseline if not done
    if (!state.posture.calibrated) {
      state.posture.autoCalFrames = (state.posture.autoCalFrames || 0) + 1;
      if (state.posture.autoCalFrames > 15) {
        calibratePosture(false);
      }
      return;
    }

    const lm = landmarks;
    const faceWidth = Math.hypot(lm[454].x - lm[234].x, lm[454].y - lm[234].y);
    const noseY = lm[1].y;
    const topDist = Math.abs(lm[1].y - lm[10].y);
    const botDist = Math.abs(lm[152].y - lm[1].y);
    const pitchRatio = botDist > 0.005 ? topDist / botDist : 1.0;
    const vertDist = Math.abs(lm[152].y - lm[10].y);

    // 1. Posture & Slouch Check
    let postureStatus = "good";
    let postureText = "Posture: Optimal";
    let postClass = "status-pill-good";

    if (state.config.postureDetection) {
      if (faceWidth > state.posture.baselineDist * 1.35) {
        postureStatus = "close";
        postureText = "Posture: Too Close";
        postClass = "status-pill-warn";
        state.posture.closeFrames++;
      } else if (noseY > state.posture.baselineY + 0.08) {
        postureStatus = "slouch";
        postureText = "Posture: Slouching";
        postClass = "status-pill-warn";
        state.posture.slouchFrames++;
      } else {
        state.posture.closeFrames = 0;
        state.posture.slouchFrames = 0;
      }

      // If slouching or leaning close for > 5 seconds in Health or Dev mode, trigger gentle posture reminder
      if ((state.currentMode === "health" || state.currentMode === "code") &&
          (state.posture.slouchFrames > 120 || state.posture.closeFrames > 120) &&
          !state.alertActive && Date.now() - state.posture.lastWarning > 30000) {
        state.posture.lastWarning = Date.now();
        playPostureChime();
        speakAlert("slouch");
      }
    }

    state.posture.status = postureStatus;
    const postPill = $("#posture-pill");
    const postText = $("#posture-status-text");
    const camPost = $("#cam-posture-display");
    if (postPill) {
      postPill.className = `posture-pill ${postClass}`;
      postText.textContent = postureText;
    }
    if (camPost) {
      camPost.textContent = postureStatus === "good" ? "Posture: OK" : `Posture: ${postureStatus.toUpperCase()}`;
      camPost.style.color = postureStatus === "good" ? "var(--success)" : "var(--warning)";
    }

    // Update Health Dashboard values if visible
    const healthPostVal = $("#health-posture-val");
    if (healthPostVal) {
      healthPostVal.textContent = postureStatus === "good" ? "Optimal" : (postureStatus === "slouch" ? "Slouching" : "Too Close");
      healthPostVal.style.color = postureStatus === "good" ? "var(--success)" : "var(--warning)";
    }

    // 2. Head Nodding / Drooping Check
    let nodText = "Head: Upright";
    let nodClass = "status-pill-good";
    if (state.config.nodDetection) {
      const isPitchCompressed = pitchRatio < state.posture.baselinePitchRatio * 0.72;
      const isVertCompressed = vertDist < state.posture.baselineVertDist * 0.76;
      const isDrooping = isPitchCompressed || isVertCompressed;

      if (isDrooping) {
        if (!state.nodding.nodStartTime) state.nodding.nodStartTime = Date.now();
        const nodDuration = (Date.now() - state.nodding.nodStartTime) / 1000;
        if (nodDuration >= 1.2) {
          nodText = "Head: Nodding!";
          nodClass = "status-pill-danger";
          if (!state.alertActive && !state.dismissCooldown && Date.now() - state.nodding.lastAlert > 10000) {
            state.nodding.lastAlert = Date.now();
            state.drowsyEpisodes++;
            $("#stat-drowsy").textContent = state.drowsyEpisodes;
            triggerAlert(false, "nodding");
          }
        } else {
          nodText = "Head: Tilting...";
          nodClass = "status-pill-warn";
        }
      } else {
        state.nodding.nodStartTime = null;
      }
    }
    const nodPill = $("#nod-pill");
    const nodTextEl = $("#nod-status-text");
    if (nodPill) {
      nodPill.className = `posture-pill ${nodClass}`;
      nodTextEl.textContent = nodText;
    }

    // 3. Flow & Fatigue Index calculation for Code & Creative Modes
    const flowVal = $("#flow-index-val");
    const fatigueVal = $("#flow-fatigue-val");
    const fatigueAdv = $("#flow-fatigue-advice");
    if (flowVal && fatigueVal) {
      const focusScore = Math.max(10, Math.min(99, Math.round(100 - perclos * 0.8 - (avgEAR < 0.22 ? 25 : 0))));
      flowVal.textContent = `${focusScore >= 75 ? "High" : (focusScore >= 50 ? "Moderate" : "Low")} (${focusScore}%)`;
      flowVal.style.color = focusScore >= 75 ? "var(--accent)" : (focusScore >= 50 ? "var(--warning)" : "var(--danger)");

      if (perclos < 20) {
        fatigueVal.textContent = "Fresh";
        fatigueVal.style.color = "var(--success)";
        if (fatigueAdv) fatigueAdv.textContent = "Optimal state for complex architecture & deep coding";
      } else if (perclos < 45) {
        fatigueVal.textContent = "Moderate";
        fatigueVal.style.color = "var(--warning)";
        if (fatigueAdv) fatigueAdv.textContent = "Focus declining. Keep hydrated and take regular pauses.";
      } else {
        fatigueVal.textContent = "High Fatigue";
        fatigueVal.style.color = "var(--danger)";
        if (fatigueAdv) fatigueAdv.textContent = "Alertness low! Avoid critical merges without testing.";
      }
    }
  }

  function addStudyBookmark(reason) {
    const player = $("#media-player");
    const seconds = player && !isNaN(player.currentTime) ? Math.floor(player.currentTime) : 0;
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    const formatted = `${mins}:${secs}`;
    const item = {
      seconds,
      formatted,
      reason: reason || "Lecture Bookmark",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    state.study.bookmarks.unshift(item);
    renderStudyBookmarks();
  }

  function renderStudyBookmarks() {
    const list = $("#study-bookmarks-list");
    if (!list) return;
    if (state.study.bookmarks.length === 0) {
      list.innerHTML = `<p class="empty-hint">No bookmarks yet. If you nod off or close your eyes during a lecture, SleepGuard auto-saves the timestamp here so you can resume!</p>`;
      return;
    }
    list.innerHTML = state.study.bookmarks.map((b, i) => `
      <div class="bookmark-item" data-idx="${i}" title="Click to jump player to ${b.formatted}">
        <span class="bookmark-time">⏱️ ${b.formatted}</span>
        <span class="bookmark-note">${b.reason} (${b.timestamp})</span>
        <span class="btn btn-ghost btn-sm" style="padding:2px 8px;">▶ Jump</span>
      </div>
    `).join("");

    list.querySelectorAll(".bookmark-item").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.dataset.idx);
        const b = state.study.bookmarks[idx];
        const player = $("#media-player");
        if (player && b) {
          player.currentTime = b.seconds;
          player.play().catch(() => {});
        }
      });
    });
  }

  function startBreakTimer() {
    stopBreakTimer();
    state.eyeBreak.remainingSec = state.eyeBreak.intervalSec;
    state.eyeBreak.timerId = setInterval(() => {
      if (!state.monitoring) return;
      state.eyeBreak.remainingSec--;
      updateBreakCountdown();
      if (state.eyeBreak.remainingSec <= 0) {
        state.eyeBreak.remainingSec = state.eyeBreak.intervalSec;
        if (state.config.breakReminder) {
          triggerEyeBreak();
        }
      }
    }, 1000);
  }

  function stopBreakTimer() {
    if (state.eyeBreak.timerId) {
      clearInterval(state.eyeBreak.timerId);
      state.eyeBreak.timerId = null;
    }
  }

  function updateBreakCountdown() {
    const m = String(Math.floor(state.eyeBreak.remainingSec / 60)).padStart(2, "0");
    const s = String(state.eyeBreak.remainingSec % 60).padStart(2, "0");
    const el = $("#health-break-countdown");
    if (el) el.textContent = `${m}:${s}`;
  }

  function triggerEyeBreak() {
    const modal = $("#break-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    state.eyeBreak.active = true;
    playPostureChime();

    let duration = 20;
    const fill = $("#break-timer-fill");
    const text = $("#break-timer-text");
    const circ = 2 * Math.PI * 40;
    if (text) text.textContent = duration;
    if (fill) fill.style.strokeDashoffset = circ;

    if (state.eyeBreak.modalTimerId) clearInterval(state.eyeBreak.modalTimerId);
    let elapsed = 0;
    state.eyeBreak.modalTimerId = setInterval(() => {
      elapsed++;
      const rem = duration - elapsed;
      if (text) text.textContent = Math.max(0, rem);
      if (fill) fill.style.strokeDashoffset = circ - (elapsed / duration) * circ;
      if (elapsed >= duration) {
        clearInterval(state.eyeBreak.modalTimerId);
        dismissEyeBreak();
      }
    }, 1000);
  }

  function dismissEyeBreak() {
    const modal = $("#break-modal");
    if (modal) modal.classList.add("hidden");
    if (state.eyeBreak.modalTimerId) {
      clearInterval(state.eyeBreak.modalTimerId);
      state.eyeBreak.modalTimerId = null;
    }
    state.eyeBreak.active = false;
    playBinauralChime();
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
  function sendBrowserNotification(reason) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
      let title = "⚠️ SleepGuard — WAKE UP!";
      let body = "You appear to be falling asleep! Click to return.";
      if (reason === "nodding") {
        title = "⚠️ SleepGuard — Head Drooping!";
        body = "Microsleep / head nodding detected. Click to check in.";
      } else if (reason === "slouch") {
        title = "🧘 SleepGuard — Posture Check";
        body = "Slouching or screen proximity detected. Sit upright.";
      } else if (state.currentMode === "study") {
        title = "📚 SleepGuard — Study Alert";
        body = "Lecture paused and timestamp saved. Click to resume!";
      }

      const n = new Notification(title, {
        body: body,
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
