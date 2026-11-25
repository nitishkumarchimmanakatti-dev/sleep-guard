# 👁️ SleepGuard — AI Focus, Posture & Sleep Detection System

**SleepGuard** is a free, browser-based AI application that uses your laptop camera to monitor eye openness, head posture, and fatigue levels across multiple creative workflows. Whether you're watching movies, late-night coding, editing video, studying lectures, or working at a desk, SleepGuard protects your focus and health.

![SleepGuard Demo](https://img.shields.io/badge/Status-Active-brightgreen) ![License](https://img.shields.io/badge/License-MIT-blue) ![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

## 🎯 5 Specialized Work Modes

| Mode | Target User | Key Capabilities | Alert Style |
| :--- | :--- | :--- | :--- |
| **🎬 Movie Mode** | Movie & show watchers | High-sensitivity eye closure detection, VLC Picture-in-Picture floating monitor | Loud siren alarm + red screen flash + auto video pause |
| **💻 Code & Dev Mode** | Late-night programmers | Head nodding/microsleep detection, low-blink dry eye warnings, mental fatigue index | Soothing harmonic binaural bell chime |
| **🎨 Creative Mode** | Designers & video editors | Focus flow state meter, zone-out prevention during long renders or timeline edits | Ambient glow pulse + soft bell |
| **📚 Study Mode** | Students watching lectures | Rapid 1.8s sleep alert, motivational voice nudge, **Auto-Bookmark timestamps** when nodding off | Motivational speech + lecture auto-pause & timestamp bookmark |
| **🧘 Posture & Health** | Desk workers | Real-time spine slouching detector, screen proximity warning, interactive **20-20-20 Eye Break** timer | Gentle marimba posture chime + 20s rest countdown |

## ✨ Core Features

- 🧠 **AI-Powered 468-Point Mesh** — Uses MediaPipe FaceMesh for real-time facial landmark detection
- 👁️ **Eye Aspect Ratio (EAR)** — High-precision drowsiness detection based on eye openness measurement
- 📐 **Head Pitch & Nodding Detection** — Computes facial foreshortening and pitch ratios to catch microsleep before your head drops
- 🪑 **Ergonomic Posture Guardian** — Tracks nose, chin, and temple coordinates to detect slouching and excessive screen proximity
- 🌿 **20-20-20 Eye Strain Prevention** — Built-in 20-minute rest interval with interactive 20-second circular countdown timer
- 📍 **Study Lecture Bookmarking** — Automatically logs the exact video timestamp when you nod off so you can resume with 1 click
- 🎵 **Adaptive Sound Profiles** — Automatic selection of loud sirens, binaural focus chords, or gentle marimba chimes depending on mode
- 🖼️ **Picture-in-Picture Floating Window** — Floats over VLC, Premiere, VS Code, or any fullscreen window
- 📊 **Real-time Analytics** — EAR graph, blink rate, PERCLOS fatigue score, flow index, and drowsiness gauge
- 🔔 **Background Tab Execution** — Web Worker timer and silent audio keepalive prevent browser throttling
- 🆓 **100% Client-Side & Free** — No accounts, no subscriptions, zero data sent to external servers

## 🚀 Getting Started

### Prerequisites
- A modern web browser (Chrome recommended for Picture-in-Picture support)
- A webcam/laptop camera
- Python 3 (for local server)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/sleep-guard.git
   cd sleep-guard
   ```

2. **Start the local server:**
   ```bash
   python3 -m http.server 3000
   ```

3. **Open in browser:**
   ```
   http://localhost:3000
   ```

4. **Allow camera access** when prompted.

5. **Click "Start Monitoring"** and you're good to go!

### Using with VLC / External Apps

1. Start monitoring in SleepGuard
2. Click **🖼️ Float Over VLC** to open the Picture-in-Picture monitor
3. Switch to VLC or any other app
4. The floating webcam window stays on top and keeps monitoring your eyes
5. If you fall asleep → loud alarm + voice alert + notification!

## 🛠️ Tech Stack

| Technology | Purpose |
|-----------|---------|
| **MediaPipe FaceMesh** | 468-point facial landmark detection |
| **Web Audio API** | Alarm sound generation |
| **Speech Synthesis API** | Voice wake-up alerts |
| **Picture-in-Picture API** | Floating monitor window |
| **Web Workers** | Background processing (no throttling) |
| **Screen Wake Lock API** | Prevents screen from dimming |
| **Notification API** | System-level alert notifications |
| **Canvas API** | Face mesh visualization & EAR graph |

## 📖 How It Works

1. **Face Detection** — MediaPipe FaceMesh detects 468 facial landmarks in real-time
2. **EAR Calculation** — Eye Aspect Ratio is computed from 6 eye landmarks per eye
3. **Drowsiness Scoring** — Combines EAR + PERCLOS (% eye closure over time) for accuracy
4. **Alert Triggering** — When eyes stay closed beyond the threshold, multi-level alerts fire
5. **Background Monitoring** — Silent audio + Web Worker ensure detection runs even when tab is backgrounded

## ⚙️ Configuration

Access settings via the ⚙️ gear icon:

- **EAR Threshold** — Sensitivity of eye closure detection (lower = more sensitive)
- **Alert Delay** — Seconds of eye closure before alert triggers (1-10s)
- **Alert Volume** — Volume of the alarm sound (0-100%)
- **Alert Types** — Toggle sound, flash, voice, and vibration independently
- **Camera Source** — Select which camera to use

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 🤝 Contributing

Contributions are welcome! Feel free to open issues and pull requests.

---

**Made with ❤️ — Stay awake, stay safe!**
