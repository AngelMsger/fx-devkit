"""Observable contracts for the recorder and partial-initialization assessor."""

import json
import base64
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

from assess import consent_timing, init_findings


HERE = Path(__file__).resolve().parent


class RecorderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.output = Path(self.temp.name) / "capture"

    def tearDown(self):
        self.temp.cleanup()

    def invoke(self, code, *options):
        return subprocess.run([sys.executable, str(HERE / "capture.py"), "--output", str(self.output),
                               *options, "--", sys.executable, "-u", "-c", code], capture_output=True, timeout=10)

    def test_separate_streams_and_measured_silence(self):
        result = self.invoke("import sys,time; print('first'); time.sleep(.15); print('second',file=sys.stderr); raise SystemExit(7)")
        self.assertEqual(result.returncode, 7)
        self.assertEqual((self.output / "stdout.log").read_bytes(), b"first\n")
        self.assertEqual((self.output / "stderr.log").read_bytes(), b"second\n")
        receipt = json.loads((self.output / "receipt.json").read_text())
        self.assertGreaterEqual(receipt["max_silence_seconds"], .14)
        self.assertLess(receipt["first_output_seconds"], receipt["duration_seconds"])

    def test_real_terminal(self):
        result = self.invoke("import sys; print(sys.stdout.isatty(),sys.stderr.isatty())", "--terminal")
        self.assertEqual(result.returncode, 0)
        self.assertIn(b"True True", (self.output / "terminal.log").read_bytes())

    def test_timeout_terminates_descendants_and_records_reason(self):
        marker = Path(self.temp.name) / "escaped"
        child = f"import time; from pathlib import Path; time.sleep(1); Path({str(marker)!r}).write_text('escaped')"
        code = f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',{child!r}]); time.sleep(10)"
        result = self.invoke(code, "--timeout", ".15")
        self.assertEqual(result.returncode, 124)
        time.sleep(1)
        self.assertFalse(marker.exists())
        self.assertEqual(json.loads((self.output / "receipt.json").read_text())["stop_reason"], "timeout")

    def test_signal_is_recorded(self):
        proc = subprocess.Popen([sys.executable, str(HERE / "capture.py"), "--output", str(self.output),
                                 "--", sys.executable, "-c", "import time; time.sleep(10)"])
        deadline = time.monotonic() + 3
        while not (self.output / "command.json").exists() and time.monotonic() < deadline:
            time.sleep(.02)
        time.sleep(.1)
        os.kill(proc.pid, signal.SIGTERM)
        self.assertEqual(proc.wait(timeout=5), 143)
        self.assertEqual(json.loads((self.output / "receipt.json").read_text())["stop_reason"], "SIGTERM")

    def test_partial_initialization_cannot_pass(self):
        complete = {"operation": "apply", "registered": True,
                    "preparation": {"state": "ready", "warnings": [{"message": "Optional activation unverified"}]}}
        self.assertEqual(init_findings(complete), [])
        complete["preparation"] = {"state": "incomplete", "blockers": [{"message": "Access is missing"}]}
        complete["sync"] = {"summary": {"done": 3, "failed": 0}}
        self.assertEqual(init_findings(complete), ["Access is missing"])
        self.assertTrue(init_findings({"written": True}))

    def test_consent_wait_does_not_hide_a_later_silent_operation(self):
        def output(seconds, text):
            return {"seconds": seconds, "stream": "terminal", "bytes_base64": base64.b64encode(text.encode()).decode()}
        events = [output(1, "Trust this command? [y/N]"),
                  {"seconds": 101, "stream": "input_activity"},
                  output(101.1, "y\n"), output(121, "finished")]
        timing = consent_timing(events, 122)
        self.assertEqual(timing["consent_wait_seconds"], 100)
        self.assertEqual(timing["active_duration_seconds"], 22)
        self.assertAlmostEqual(timing["active_max_silence_seconds"], 19.9)


if __name__ == "__main__":
    unittest.main()
