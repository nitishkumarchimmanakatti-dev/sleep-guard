# 👁️ SleepGuard — AI Sleep Detection & Alert System

**SleepGuard** is a free, browser-based AI application that uses your laptop camera to detect if you fall asleep while watching movies or content. It alerts you with loud alarms, voice alerts, and screen flashes to wake you up.

![SleepGuard Demo](https://img.shields.io/badge/Status-Active-brightgreen) ![License](https://img.shields.io/badge/License-MIT-blue) ![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

## ✨ Features

- 🧠 **AI-Powered Eye Tracking** — Uses MediaPipe FaceMesh for real-time facial landmark detection
- 👁️ **Eye Aspect Ratio (EAR)** — Precise drowsiness detection based on eye openness measurement
- 🔊 **Multi-Level Alert System** — Sound alarm, voice alerts ("Wake up!"), screen flash, vibration
- 🖼️ **Picture-in-Picture Mode** — Float the monitor over VLC, Netflix, or any app
- 📊 **Real-time Analytics** — EAR graph, blink count, blink rate, PERCLOS, drowsiness gauge
- 🎯 **Calibration System** — Personalized thresholds calibrated to your eyes
- 🎬 **Built-in Video Player** — Drag & drop video files to watch directly
- 🔔 **Browser Notifications** — Alerts work even when using external apps
- 🔋 **Background Mode** — Web Worker keeps detection running when tab is in background
- ⚙️ **Configurable** — Adjust sensitivity, delay, volume, and alert types
- 🆓 **100% Free** — No API keys, no accounts, runs entirely in your browser

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
