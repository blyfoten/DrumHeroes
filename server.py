#!/usr/bin/env python3
"""DrumHero web server.

Serves the browser app and, when available, runs Demucs stem separation for it
(the web port of Analysis/DemucsAnalysisService.cs). Only the Python standard
library is needed to run the server; Demucs/librosa are optional.

    python3 server.py                 # http://localhost:8765, opens a browser
    python3 server.py --port 9000 --no-browser
    python3 server.py --python ~/venvs/demucs/bin/python
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

WEB_ROOT = Path(__file__).resolve().parent
PROGRESS_RE = re.compile(rb"(\d+(?:\.\d+)?)%\|")

CONVERT_SCRIPT = r"""
import sys, soundfile as sf
data, sr = sf.read(sys.argv[1], always_2d=True)
sf.write(sys.argv[2], data, sr)
"""

HPSS_SCRIPT = r"""
import sys, numpy as np, librosa, soundfile as sf
y, sr = librosa.load(sys.argv[1], sr=44100, mono=False)
if y.ndim == 1:
    y = y[np.newaxis, :]
harmonic, percussive = librosa.effects.hpss(y)
sf.write(sys.argv[2], percussive.T, sr, format='FLAC')
sf.write(sys.argv[3], harmonic.T, sr, format='FLAC')
"""


class Job:
    def __init__(self, workdir: Path):
        self.id = uuid.uuid4().hex
        self.workdir = workdir
        self.state = "running"
        self.progress = 0.0
        self.message = "Starting..."
        self.error = None
        self.method = None
        self.outputs = {}
        self.process = None
        self.cancelled = False

    def to_json(self):
        return {
            "id": self.id,
            "state": self.state,
            "progress": round(self.progress, 3),
            "message": self.message,
            "error": self.error,
            "method": self.method,
        }


class SeparationService:
    def __init__(self, python: str, model: str):
        self.python = python
        self.model = model
        self.jobs: dict[str, Job] = {}
        self.lock = threading.Lock()
        self.capabilities = self._probe()

    def _probe(self):
        code = (
            "import importlib.util as u, json;"
            "print(json.dumps({m: u.find_spec(m) is not None for m in ('demucs', 'librosa', 'soundfile')}))"
        )
        try:
            out = subprocess.run([self.python, "-c", code], capture_output=True, text=True, timeout=30)
            caps = json.loads(out.stdout.strip() or "{}")
        except Exception:
            caps = {}
        caps = {k: bool(caps.get(k)) for k in ("demucs", "librosa", "soundfile")}
        caps["python"] = self.python
        caps["separation"] = caps["demucs"] or (caps["librosa"] and caps["soundfile"])
        return caps

    def start(self, upload_path: Path, workdir: Path) -> Job:
        job = Job(workdir)
        with self.lock:
            self.jobs[job.id] = job
        threading.Thread(target=self._run, args=(job, upload_path), daemon=True).start()
        return job

    def get(self, job_id: str):
        with self.lock:
            return self.jobs.get(job_id)

    def remove(self, job_id: str):
        with self.lock:
            job = self.jobs.pop(job_id, None)
        if job:
            job.cancelled = True
            if job.process and job.process.poll() is None:
                job.process.kill()
            shutil.rmtree(job.workdir, ignore_errors=True)

    def _run(self, job: Job, upload_path: Path):
        try:
            audio_path = upload_path
            if self.capabilities["soundfile"]:
                job.message = "Decoding audio..."
                job.progress = 0.02
                wav = job.workdir / "input.wav"
                if subprocess.run([self.python, "-c", CONVERT_SCRIPT, str(upload_path), str(wav)],
                                  capture_output=True).returncode == 0:
                    audio_path = wav

            demucs_error = None
            if self.capabilities["demucs"]:
                demucs_error = self._run_demucs(job, audio_path)
                if demucs_error is None:
                    return self._finish(job, "demucs")
            if job.cancelled:
                return

            if self.capabilities["librosa"] and self.capabilities["soundfile"]:
                job.message = "Demucs unavailable, using HPSS fallback..." if demucs_error else "Separating (HPSS)..."
                job.progress = max(job.progress, 0.65)
                drums = job.workdir / "drums.flac"
                no_drums = job.workdir / "no_drums.flac"
                proc = subprocess.run([self.python, "-c", HPSS_SCRIPT, str(audio_path), str(drums), str(no_drums)],
                                      capture_output=True, text=True)
                if proc.returncode == 0:
                    job.outputs = {"drums": drums, "no_drums": no_drums}
                    return self._finish(job, "hpss")
                raise RuntimeError(f"{demucs_error or ''}\n\nHPSS fallback failed:\n{proc.stderr[-2000:]}".strip())

            raise RuntimeError(demucs_error or "No separation backend installed (pip install demucs).")
        except Exception as exc:  # report every failure to the client
            if not job.cancelled:
                job.state = "error"
                job.error = str(exc)
                job.message = "Separation failed."

    def _run_demucs(self, job: Job, audio_path: Path):
        out_dir = job.workdir / "demucs"
        args = [self.python, "-m", "demucs.separate", "--two-stems", "drums", "-n", self.model,
                "--flac", "-o", str(out_dir), str(audio_path)]
        job.message = "Running Demucs (the first run downloads the model, ~80 MB)..."
        job.progress = 0.05
        job.process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        tail = bytearray()
        buf = b""
        while True:
            chunk = job.process.stderr.read1(4096) if hasattr(job.process.stderr, "read1") else job.process.stderr.read(4096)
            if not chunk:
                break
            tail.extend(chunk)
            del tail[:-8000]
            buf += chunk
            parts = re.split(rb"[\r\n]", buf)
            buf = parts.pop()
            for line in parts:
                m = PROGRESS_RE.search(line)
                if m:
                    pct = float(m.group(1))
                    job.progress = 0.05 + pct / 100 * 0.9
                    job.message = f"Separating stems... {pct:.0f}%"
        code = job.process.wait()
        if job.cancelled:
            return "cancelled"
        if code != 0:
            return f"Demucs exited with code {code}:\n{tail.decode(errors='replace')[-3000:]}"

        drums = next(out_dir.rglob("drums.*"), None)
        no_drums = next(out_dir.rglob("no_drums.*"), None)
        if not drums or not no_drums:
            return "Demucs finished but its output files were not found."
        job.outputs = {"drums": drums, "no_drums": no_drums}
        return None

    @staticmethod
    def _finish(job: Job, method: str):
        job.method = method
        job.progress = 1.0
        job.message = "Separation complete."
        job.state = "done"


class Handler(SimpleHTTPRequestHandler):
    service: SeparationService = None
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def log_message(self, fmt, *args):
        if "/api/jobs/" in (self.path or "") and self.command == "GET":
            return  # progress polling is noisy
        super().log_message(fmt, *args)

    def end_headers(self):
        # The app is served from disk during development; never cache stale modules.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/status":
            return self.send_json(self.service.capabilities)
        m = re.fullmatch(r"/api/jobs/([0-9a-f]+)(?:/(drums|no_drums))?", url.path)
        if m:
            job = self.service.get(m.group(1))
            if not job:
                return self.send_json({"error": "unknown job"}, HTTPStatus.NOT_FOUND)
            if not m.group(2):
                return self.send_json(job.to_json())
            path = job.outputs.get(m.group(2))
            if not path or not path.exists():
                return self.send_json({"error": "not ready"}, HTTPStatus.CONFLICT)
            ctype = "audio/flac" if path.suffix == ".flac" else "audio/mpeg" if path.suffix == ".mp3" else "audio/wav"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(path.stat().st_size))
            self.end_headers()
            with path.open("rb") as f:
                shutil.copyfileobj(f, self.wfile)
            return
        if url.path.startswith("/api/"):
            return self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/api/separate":
            return self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        if not self.service.capabilities["separation"]:
            return self.send_json({"error": "No separation backend installed. Run: pip install demucs"},
                                  HTTPStatus.SERVICE_UNAVAILABLE)
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return self.send_json({"error": "empty upload"}, HTTPStatus.BAD_REQUEST)

        name = parse_qs(url.query).get("name", ["input.flac"])[0]
        suffix = Path(name).suffix.lower() if Path(name).suffix else ".flac"
        if not re.fullmatch(r"\.[a-z0-9]{1,5}", suffix):
            suffix = ".bin"
        workdir = Path(tempfile.mkdtemp(prefix="drumhero-"))
        upload = workdir / f"song{suffix}"
        remaining = length
        with upload.open("wb") as f:
            while remaining > 0:
                chunk = self.rfile.read(min(1 << 20, remaining))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        job = self.service.start(upload, workdir)
        self.send_json(job.to_json(), HTTPStatus.ACCEPTED)

    def do_DELETE(self):
        m = re.fullmatch(r"/api/jobs/([0-9a-f]+)", urlparse(self.path).path)
        if not m:
            return self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        self.service.remove(m.group(1))
        self.send_json({"ok": True})


def main():
    parser = argparse.ArgumentParser(description="Run the DrumHero web app.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--python", default=sys.executable,
                        help="Python interpreter that has demucs installed (default: this one)")
    parser.add_argument("--model", default="htdemucs", help="Demucs model name")
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser window")
    args = parser.parse_args()

    Handler.service = SeparationService(args.python, args.model)
    caps = Handler.service.capabilities
    backend = "Demucs" if caps["demucs"] else "librosa HPSS (fallback)" if caps["separation"] else "none"

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{'localhost' if args.host in ('127.0.0.1', '0.0.0.0') else args.host}:{args.port}/"
    print(f"DrumHero running at {url}")
    print(f"Stem separation: {backend}  (python: {caps['python']})")
    if not caps["separation"]:
        print("  -> install with: pip install demucs   (MIDI-only and plain-audio imports work without it)")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        with Handler.service.lock:
            ids = list(Handler.service.jobs)
        for job_id in ids:
            Handler.service.remove(job_id)


if __name__ == "__main__":
    main()
