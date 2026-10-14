"""Behavioral checks for the isolated runtime's graceful-drain evidence."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import threading
import time

import pytest
import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "ci"))
import e2e_backend


def _server(app):
    return uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=0, lifespan="on", log_level="critical",
    ))


def _quiescent_workers(monkeypatch):
    monkeypatch.setattr(e2e_backend, "_request_worker_stop", lambda: None)
    monkeypatch.setattr(e2e_backend, "_runner_counts", lambda: {
        "worker_loop_tasks": 0,
        "worker_inflight": 0,
        "worker_abandoned": 0,
    })


def test_graceful_signal_report_identifies_process_and_is_private(tmp_path, monkeypatch):
    _quiescent_workers(monkeypatch)
    events = []

    async def app(scope, receive, send):
        assert scope["type"] == "lifespan"
        assert (await receive())["type"] == "lifespan.startup"
        await send({"type": "lifespan.startup.complete"})
        asyncio.get_running_loop().call_later(0.15, os.kill, os.getpid(), signal.SIGTERM)
        assert (await receive())["type"] == "lifespan.shutdown"
        events.append("shutdown")
        await send({"type": "lifespan.shutdown.complete"})

    path = tmp_path / "drain.json"
    previous = signal.getsignal(signal.SIGTERM)
    assert e2e_backend._run_backend(_server(app), path, "launch-42") == 0
    report = json.loads(path.read_text())
    assert report["launch_id"] == "launch-42"
    assert report["pid"] == os.getpid()
    assert report["shutdown_complete"] is True
    assert events == ["shutdown"]
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert signal.getsignal(signal.SIGTERM) == previous
    assert list(tmp_path.iterdir()) == [path]


def test_shutdown_stops_worker_claims_before_http_and_lifespan_drain(tmp_path, monkeypatch):
    _quiescent_workers(monkeypatch)
    events = []
    admission_closed = None
    server = None

    def stop_claims():
        events.append("stop_claims")
        admission_closed.set()

    monkeypatch.setattr(e2e_backend, "_request_worker_stop", stop_claims)

    async def app(scope, receive, send):
        nonlocal admission_closed
        assert (await receive())["type"] == "lifespan.startup"
        admission_closed = asyncio.Event()

        async def request_waiting_for_worker():
            await admission_closed.wait()
            events.append("http_drained")

        pending = asyncio.create_task(request_waiting_for_worker())
        server.server_state.tasks.add(pending)
        pending.add_done_callback(server.server_state.tasks.discard)
        await send({"type": "lifespan.startup.complete"})
        loop = asyncio.get_running_loop()
        loop.call_later(0.15, os.kill, os.getpid(), signal.SIGTERM)
        # Bound a negative control: without the signal-time broadcast, the
        # HTTP drain eventually unblocks but the ordered assertion still fails.
        release = loop.call_later(0.8, admission_closed.set)
        assert (await receive())["type"] == "lifespan.shutdown"
        release.cancel()
        events.append("lifespan_shutdown")
        await send({"type": "lifespan.shutdown.complete"})

    server = _server(app)
    assert e2e_backend._run_backend(server, tmp_path / "drain.json", "admission-launch") == 0
    assert events == ["stop_claims", "http_drained", "lifespan_shutdown"]


def test_worker_stop_failure_cannot_acknowledge_drain(tmp_path, monkeypatch):
    _quiescent_workers(monkeypatch)

    def fail_stop():
        raise RuntimeError("private stop failure")

    monkeypatch.setattr(e2e_backend, "_request_worker_stop", fail_stop)

    async def app(scope, receive, send):
        assert (await receive())["type"] == "lifespan.startup"
        await send({"type": "lifespan.startup.complete"})
        asyncio.get_running_loop().call_later(0.15, os.kill, os.getpid(), signal.SIGTERM)
        assert (await receive())["type"] == "lifespan.shutdown"
        await send({"type": "lifespan.shutdown.complete"})

    path = tmp_path / "drain.json"
    assert e2e_backend._run_backend(_server(app), path, "stop-failed-launch") == 1
    report = json.loads(path.read_text())
    assert report["worker_stop_failed"] is True
    assert report["shutdown_complete"] is False
    assert "private stop failure" not in path.read_text()


@pytest.mark.parametrize("failure", ["startup", "shutdown"])
def test_lifespan_failure_cannot_acknowledge_drain(tmp_path, monkeypatch, failure):
    _quiescent_workers(monkeypatch)
    server = None

    async def app(scope, receive, send):
        assert (await receive())["type"] == "lifespan.startup"
        if failure == "startup":
            await send({"type": "lifespan.startup.failed", "message": "private detail"})
            return
        await send({"type": "lifespan.startup.complete"})
        asyncio.get_running_loop().call_later(0.15, setattr, server, "should_exit", True)
        assert (await receive())["type"] == "lifespan.shutdown"
        await send({"type": "lifespan.shutdown.failed", "message": "private detail"})

    server = _server(app)
    path = tmp_path / "drain.json"
    assert e2e_backend._run_backend(server, path, "failed-launch") == 1
    report = json.loads(path.read_text())
    assert report["shutdown_complete"] is False
    assert report["lifespan_failed"] is True
    assert "private detail" not in path.read_text()


def test_report_waits_for_cancelled_default_executor_work(tmp_path, monkeypatch):
    _quiescent_workers(monkeypatch)
    entered = threading.Event()
    finished = threading.Event()
    thread_finished_at = []
    server = None
    write_report = e2e_backend._write_report

    def write_after_thread(path, report):
        assert finished.is_set(), "drain report was published before executor work finished"
        write_report(path, report)

    monkeypatch.setattr(e2e_backend, "_write_report", write_after_thread)

    def slow_write():
        entered.set()
        time.sleep(0.55)
        thread_finished_at.append(time.monotonic())
        finished.set()

    async def app(scope, receive, send):
        assert (await receive())["type"] == "lifespan.startup"
        pending = asyncio.create_task(asyncio.to_thread(slow_write))
        while not entered.is_set():
            await asyncio.sleep(0)
        pending.cancel()
        await asyncio.gather(pending, return_exceptions=True)
        await send({"type": "lifespan.startup.complete"})
        asyncio.get_running_loop().call_later(0.05, setattr, server, "should_exit", True)
        assert (await receive())["type"] == "lifespan.shutdown"
        await send({"type": "lifespan.shutdown.complete"})

    server = _server(app)
    path = tmp_path / "drain.json"
    assert e2e_backend._run_backend(server, path, "thread-launch") == 0
    returned_at = time.monotonic()
    assert finished.is_set()
    assert thread_finished_at[0] <= returned_at
    assert path.stat().st_mtime_ns > 0
    assert json.loads(path.read_text())["shutdown_complete"] is True


def test_runner_cancellation_cannot_hide_abandoned_worker(tmp_path, monkeypatch):
    monkeypatch.setattr(e2e_backend, "_runner_counts", lambda: {
        "worker_loop_tasks": 0,
        "worker_inflight": 1,
        "worker_abandoned": 1,
    })
    server = None

    async def app(scope, receive, send):
        assert (await receive())["type"] == "lifespan.startup"
        asyncio.create_task(asyncio.sleep(60))
        await send({"type": "lifespan.startup.complete"})
        asyncio.get_running_loop().call_later(0.05, setattr, server, "should_exit", True)
        assert (await receive())["type"] == "lifespan.shutdown"
        await send({"type": "lifespan.shutdown.complete"})

    server = _server(app)
    path = tmp_path / "drain.json"
    assert e2e_backend._run_backend(server, path, "abandoned-launch") == 1
    report = json.loads(path.read_text())
    assert report["shutdown_complete"] is False
    assert report["pending_tasks"] == 1
    assert report["worker_inflight"] == 1
    assert report["worker_abandoned"] == 1


def test_launcher_exception_returns_only_bounded_diagnostics(tmp_path, monkeypatch):
    _quiescent_workers(monkeypatch)
    server = _server(None)

    async def fail():
        raise RuntimeError("sensitive exception detail")

    monkeypatch.setattr(server, "_serve", fail)
    path = tmp_path / "drain.json"
    assert e2e_backend._run_backend(server, path, "exception-launch") == 1
    report = json.loads(path.read_text())
    assert report["launcher_failed"] is True
    assert report["shutdown_complete"] is False
    assert "sensitive exception detail" not in path.read_text()


def test_cli_loads_app_directory_and_exits_normally_after_sigterm(tmp_path):
    (tmp_path / "drain_fixture.py").write_text(
        "import os\n"
        "from pathlib import Path\n"
        "async def app(scope, receive, send):\n"
        "    assert scope['type'] == 'lifespan'\n"
        "    assert (await receive())['type'] == 'lifespan.startup'\n"
        "    await send({'type': 'lifespan.startup.complete'})\n"
        "    Path(os.environ['AKB_TEST_READY']).touch()\n"
        "    assert (await receive())['type'] == 'lifespan.shutdown'\n"
        "    await send({'type': 'lifespan.shutdown.complete'})\n"
    )
    ready = tmp_path / "ready"
    report = tmp_path / "drain.json"
    environment = os.environ.copy()
    environment["AKB_TEST_READY"] = str(ready)
    environment["PYTHONPATH"] = str(Path(__file__).resolve().parents[1])
    process = subprocess.Popen([
        sys.executable, str(Path(e2e_backend.__file__)),
        "--app-dir", str(tmp_path), "--app", "drain_fixture:app",
        "--host", "127.0.0.1", "--port", "0",
        "--drain-report", str(report), "--launch-id", "cli-launch",
    ], env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 5
        while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.01)
        assert ready.exists()
        process.send_signal(signal.SIGTERM)
        _stdout, stderr = process.communicate(timeout=5)
        assert process.returncode == 0, stderr.decode()
        evidence = json.loads(report.read_text())
        assert evidence["shutdown_complete"] is True
        assert evidence["pid"] == process.pid
        assert evidence["launch_id"] == "cli-launch"
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
