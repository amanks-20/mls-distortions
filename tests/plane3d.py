#!/usr/bin/env python3
"""Dev-only: the 3D view draws exactly one scan plane, the selected scanner's.

Needs Google Chrome and a local server on the repo root:
    python3 -m http.server 8765        # repo root, separate terminal
    python3 tests/plane3d.py

For presets A1, A2, B1 and both sides, in the 3D view, reads
window.mlsView3D.drawn.planes (the planes the last frame drew; reading it does
not change the drawing) and checks:
  - toggle on: exactly one plane, of the selected side; legend names that side
  - toggle off (switched with the keyboard): no plane, legend hidden
  - mid-scan Left/Right switch: the plane follows the new side at once
  - 2D view: no toggle and no plane legend entry
Uses the DevTools client in tests/perf3d.py.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from perf3d import WS, CHROME  # noqa: E402

STATE = r"""
(function () {
    var b = document.getElementById('ex-3d-plane'), leg = document.getElementById('ex-legend-plane');
    return { planes: window.mlsView3D.drawn.planes.slice(), pressed: b.getAttribute('aria-pressed'),
             button: !!b.offsetParent, legend: !!leg.offsetParent, legendText: leg.textContent.trim() };
})()
"""
MIDSCAN_SWITCH = r"""
(function (to) {
    var raf = window.requestAnimationFrame, cb = null;
    window.requestAnimationFrame = function (f) { cb = f; return 1; };
    document.getElementById('ex-play').click();
    cb(0); cb(1300);                                            // hold at mid-scan
    window.requestAnimationFrame = raf;
    document.querySelector('#explorer [data-side="' + to + '"]').click();
    return window.mlsView3D.drawn.planes.slice();
})(%s)
"""
LEGEND = {"L": "scan plane (left, red)", "R": "scan plane (right, blue)"}


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    prof = tempfile.mkdtemp(prefix="plane3d-")
    dbg = 9336
    proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", f"--user-data-dir={prof}",
                             f"--remote-debugging-port={dbg}", "--window-size=1440,2400", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    fails = []
    try:
        for _ in range(100):
            try:
                pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{dbg}/json/list"))
                if pages:
                    break
            except OSError:
                time.sleep(0.1)
        ws = WS(next(p for p in pages if p.get("type") == "page")["webSocketDebuggerUrl"])
        ws.call("Page.enable")

        def ev(expr):
            return ws.call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)["result"].get("value")

        def key(k, code, vk, text):
            # keyDown carries the text, as a real key press does (Enter activates a button on it)
            ws.call("Input.dispatchKeyEvent", type="keyDown", key=k, code=code, windowsVirtualKeyCode=vk, text=text)
            ws.call("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=vk)

        def expect(name, cond, got):
            print(f"  {'ok  ' if cond else 'FAIL'} {name}: {got}")
            if not cond:
                fails.append(f"{name}: {got}")

        for case in ("A1", "A2", "B1"):
            for side in ("L", "R"):
                print(f"{case}-{side}")
                ws.call("Page.navigate", url=f"http://localhost:{port}/index.html?case={case}&side={side}&view=3d")
                time.sleep(1.2)
                s = ev(STATE)
                expect("on: one plane, selected side", s["planes"] == [side] and s["pressed"] == "true", s["planes"])
                expect("on: legend", s["legend"] and s["legendText"] == LEGEND[side], s["legendText"])
                ev("document.getElementById('ex-3d-plane').focus()")
                key(" ", "Space", 32, " ")                                 # keyboard: Space toggles off
                time.sleep(0.1)
                s = ev(STATE)
                expect("off (Space): no plane", s["planes"] == [] and s["pressed"] == "false", s["planes"])
                expect("off: legend hidden", not s["legend"], s["legend"])
                key("Enter", "Enter", 13, "\r")                             # keyboard: Enter toggles back on
                time.sleep(0.1)
                s = ev(STATE)
                expect("on again (Enter)", s["planes"] == [side] and s["pressed"] == "true", s["planes"])
                other = "R" if side == "L" else "L"
                got = ev(MIDSCAN_SWITCH % json.dumps(other))
                expect(f"mid-scan switch to {other}", got == [other], got)
                s = ev(STATE)
                expect("legend follows switch", s["legendText"] == LEGEND[other], s["legendText"])

        print("2D view")
        ws.call("Page.navigate", url=f"http://localhost:{port}/index.html?case=A1&side=R")
        time.sleep(1.2)
        s = ev(STATE)
        expect("2D: no toggle, no plane legend", not s["button"] and not s["legend"], (s["button"], s["legend"]))
    finally:
        proc.terminate()

    print()
    if fails:
        print(f"FAIL: {len(fails)} check(s)")
        return 1
    print("PASS: one plane (the selected scanner's) when on, none when off, none in 2D")
    return 0


if __name__ == "__main__":
    sys.exit(main())
