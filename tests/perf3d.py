#!/usr/bin/env python3
"""Dev-only: dots drawn per frame and draw time of the 3D view, per preset x side.

Needs Google Chrome and a local server on the repo root:
    python3 -m http.server 8765        # repo root, separate terminal
    python3 tests/perf3d.py [--density medium] [--frames 40]

Drives headless Chrome over the DevTools protocol (standard library only, with a
minimal WebSocket client) so timings use the real clock; --virtual-time-budget
freezes performance.now(). For each case it opens /index.html?case=..&side=..
&view=3d, wraps the canvas context's arc() to count dots in one frame (minus
the scanner marker), then times window.mlsRedraw() over --frames frames.
Timings are for this machine's CPU; a phone is typically several times slower.
"""
import argparse
import base64
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CAP = 6000            # MAX_POINTS in static/js/view3d.js
FRAME_BUDGET = 16.0   # ms, ~60 fps


class WS:
    """Just enough of RFC 6455 for CDP: masked text frames out, text frames in."""

    def __init__(self, url):
        rest = url.split("://", 1)[1]
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.s = socket.create_connection((host, int(port)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(4096)
        self.buf = buf.split(b"\r\n\r\n", 1)[1]
        self.n = 0

    def _recv(self, k):
        while len(self.buf) < k:
            self.buf += self.s.recv(65536)
        out, self.buf = self.buf[:k], self.buf[k:]
        return out

    def send(self, obj):
        data = json.dumps(obj).encode()
        hdr = bytearray([0x81])
        ln = len(data)
        if ln < 126:
            hdr.append(0x80 | ln)
        elif ln < 65536:
            hdr.append(0x80 | 126); hdr += struct.pack(">H", ln)
        else:
            hdr.append(0x80 | 127); hdr += struct.pack(">Q", ln)
        mask = os.urandom(4)
        self.s.sendall(bytes(hdr) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        msg = b""
        while True:
            b0, b1 = self._recv(2)
            ln = b1 & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", self._recv(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", self._recv(8))[0]
            msg += self._recv(ln)
            if b0 & 0x80:
                return json.loads(msg)

    def call(self, method, **params):
        self.n += 1
        self.send({"id": self.n, "method": method, "params": params})
        while True:
            m = self.recv()
            if m.get("id") == self.n:
                if "error" in m:
                    raise RuntimeError(m["error"])
                return m.get("result", {})


MEASURE = r"""
(async function (density, frames) {
    for (var i = 0; i < 100 && !(window.mlsView3D && window.mlsRedraw && window.mlsView3D.active()); i++)
        await new Promise(function (r) { setTimeout(r, 50); });
    if (!window.mlsView3D || !window.mlsView3D.active()) return { error: '3D view not active' };
    var btn = document.querySelector('[data-density="' + density + '"]');
    if (btn) btn.click();
    var ctx = document.querySelector('#explorer canvas').getContext('2d');
    var arc = ctx.arc, n = 0;
    ctx.arc = function () { n++; return arc.apply(this, arguments); };
    window.mlsRedraw();
    var dots = n - 1;                          // minus the scanner marker
    ctx.arc = arc;
    window.mlsRedraw();                        // warm-up
    var t0 = performance.now();
    for (var f = 0; f < frames; f++) window.mlsRedraw();
    var ms = (performance.now() - t0) / frames;
    var top = !document.getElementById('ex-3d-notop') || document.getElementById('ex-3d-notop').hidden;
    var legend = Array.from(document.querySelectorAll('.legend span')).filter(function (s) { return s.querySelector('.l-line'); })[0];
    return { dots: dots, ms: ms, topFace: top, scanLineLegendHidden: legend ? legend.hidden : null,
             canvas: [ctx.canvas.width, ctx.canvas.height] };
})(%s, %d)
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--density", default="medium", choices=["dense", "medium", "sparse"])
    ap.add_argument("--frames", type=int, default=40)
    a = ap.parse_args()

    prof = tempfile.mkdtemp(prefix="perf3d-")
    dbg = 9333
    proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", f"--user-data-dir={prof}",
                             f"--remote-debugging-port={dbg}", "--window-size=1440,2400",
                             "--force-device-scale-factor=2", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{dbg}/json/list"))
                if pages:
                    break
            except OSError:
                time.sleep(0.1)
        page = next(p for p in pages if p.get("type") == "page")
        ws = WS(page["webSocketDebuggerUrl"])
        ws.call("Page.enable")
        rows = []
        for case in ["A1", "B1", "A3", "A2", "C1", "D2"]:
            for side in ["L", "R"]:
                ws.call("Page.navigate", url=f"http://localhost:{a.port}/index.html?case={case}&side={side}&view=3d")
                time.sleep(1.2)
                res = ws.call("Runtime.evaluate", expression=MEASURE % (json.dumps(a.density), a.frames),
                              awaitPromise=True, returnByValue=True)
                v = res["result"]["value"]
                if "error" in v:
                    sys.exit(f"{case}-{side}: {v['error']}")
                rows.append((f"{case}-{side}", v))
    finally:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()

    print(f"3D view, density = {a.density}, {a.frames} frames each, canvas {rows[0][1]['canvas'][0]}x{rows[0][1]['canvas'][1]} device px")
    print(f"{'case':6} {'dots/frame':>10} {'% of cap':>8} {'ms/frame':>9}  top face  scan-line legend hidden  flags")
    flagged = 0
    for cid, v in rows:
        flags = []
        if v["dots"] >= 0.8 * CAP:
            flags.append(f"near {CAP} cap")
        if v["ms"] > FRAME_BUDGET:
            flags.append(f"> {FRAME_BUDGET:.0f} ms")
        flagged += bool(flags)
        print(f"{cid:6} {v['dots']:10d} {100 * v['dots'] / CAP:7.1f}% {v['ms']:9.2f}  {'yes' if v['topFace'] else 'NO':>8}  "
              f"{str(v['scanLineLegendHidden']):>23}  {', '.join(flags) or '-'}")
    print(f"\n{flagged} case(s) flagged (near cap = within 20% of {CAP}; slow = over {FRAME_BUDGET:.0f} ms)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
