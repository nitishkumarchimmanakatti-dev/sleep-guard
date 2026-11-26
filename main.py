#!/usr/bin/env python3
"""
SleepGuard AI - Local Server Runner
Serves the web application, automatically opens your browser,
and handles clean shutdown on Ctrl+C.
"""

import http.server
import os
import signal
import socket
import socketserver
import sys
import threading
import time
import webbrowser

DEFAULT_PORT = 3000

def find_available_port(start_port=3000, max_attempts=20):
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("", port))
                return port
            except OSError:
                continue
    return start_port

class DualStackServer(http.server.ThreadingHTTPServer):
    def server_bind(self):
        # Allow immediate socket reuse on restart
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        super().server_bind()

def main():
    # Ensure working directory is the folder containing this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    port = find_available_port(DEFAULT_PORT)
    url = f"http://localhost:{port}"

    print("=" * 55)
    print("  👁  SleepGuard AI - Sleep & Posture Detection")
    print("=" * 55)
    print(f"  ✓ App running at: {url}")
    print("  ✓ Opening browser automatically...")
    print("=" * 55)
    print("  🛑 To STOP: Press Ctrl + C in this terminal")
    print("=" * 55 + "\n")

    handler = http.server.SimpleHTTPRequestHandler

    try:
        httpd = DualStackServer(("", port), handler)
    except Exception as e:
        print(f"Error starting server on port {port}: {e}")
        sys.exit(1)

    # Clean signal exit handler (avoids TCPServer deadlock on shutdown)
    def handle_exit(sig, frame):
        print("\n\n🛑 Stopping SleepGuard...")
        try:
            httpd.server_close()
        except Exception:
            pass
        print("✓ Stopped successfully. Goodbye!\n")
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    # Open browser automatically after a short delay
    def open_browser():
        time.sleep(0.5)
        webbrowser.open(url)

    threading.Thread(target=open_browser, daemon=True).start()

    try:
        httpd.serve_forever()
    except (KeyboardInterrupt, SystemExit):
        handle_exit(None, None)

if __name__ == "__main__":
    main()
