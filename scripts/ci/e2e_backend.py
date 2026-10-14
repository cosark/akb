"""Test-only backend launcher with an explicit graceful-drain acknowledgement.

The supervisor may reset shared storage only after this report, normal process
exit, and its own process/session checks agree. A signal or a worker stop call
alone is not an acknowledgement. The report is written after Runner closes,
which joins the default executor; Python joins dedicated non-daemon executor
threads at interpreter exit, so the supervisor must also wait for process exit.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
from typing import Any

import uvicorn


def _runner_counts() -> dict[str, int]:
    from app.services._backfill import runner_snapshots

    snapshots = runner_snapshots()
    return {
        "worker_loop_tasks": sum(item["loop_tasks"] for item in snapshots),
        "worker_inflight": sum(item["inflight"] for item in snapshots),
        "worker_abandoned": sum(item["abandoned"] for item in snapshots),
    }


def _request_worker_stop() -> None:
    from app.services._backfill import request_stop_all

    request_stop_all()


def _empty_diagnostics() -> dict[str, bool | int]:
    return {
        "launcher_failed": False,
        "lifespan_failed": True,
        "forced_exit": False,
        "pending_tasks": 0,
        "http_tasks": 0,
        "connections": 0,
        "worker_loop_tasks": 0,
        "worker_inflight": 0,
        "worker_abandoned": 0,
        "runner_snapshot_failed": False,
        "worker_stop_failed": False,
    }


async def _serve_and_observe(server: uvicorn.Server) -> dict[str, bool | int]:
    await server._serve()
    # The lifespan task sets its shutdown event before its final return. Let
    # its callbacks finish before counting tasks; remaining work is a failure,
    # rather than something Runner's implicit cancellation can hide.
    await asyncio.sleep(0)
    current = asyncio.current_task()
    diagnostics = _empty_diagnostics()
    diagnostics.update({
        "lifespan_failed": bool(
            not server.started
            or server.lifespan.startup_failed
            or server.lifespan.shutdown_failed
            or server.lifespan.error_occurred
            or not server.lifespan.shutdown_event.is_set()
        ),
        "forced_exit": bool(server.force_exit),
        "pending_tasks": len([
            task for task in asyncio.all_tasks()
            if task is not current and not task.done()
        ]),
        "http_tasks": len([task for task in server.server_state.tasks if not task.done()]),
        "connections": len(server.server_state.connections),
    })
    try:
        diagnostics.update(_runner_counts())
    except Exception:
        diagnostics["runner_snapshot_failed"] = True
    # Counts are bounded diagnostics, never task reprs, request content,
    # credentials, or exception messages.
    for name, value in diagnostics.items():
        if type(value) is int:
            diagnostics[name] = min(max(value, 0), 1_000_000)
    return diagnostics


def _write_report(path: Path, report: dict[str, Any]) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".e2e-drain-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(report, handle, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _run_backend(server: uvicorn.Server, report_path: Path, launch_id: str) -> int:
    diagnostics = _empty_diagnostics()
    worker_stop_failed = False

    def request_shutdown(signum: int, _frame: Any) -> None:
        nonlocal worker_stop_failed
        if server.should_exit and signum == signal.SIGINT:
            server.force_exit = True
        server.should_exit = True
        # Close worker admission at the same boundary as HTTP admission. The
        # ordinary lifespan hook runs after HTTP drain, which would otherwise
        # let workers continue claiming rows while those requests finish.
        try:
            _request_worker_stop()
        except Exception:
            worker_stop_failed = True

    previous = {
        signum: signal.signal(signum, request_shutdown)
        for signum in (signal.SIGTERM, signal.SIGINT)
    }
    try:
        try:
            # _serve avoids Uvicorn's signal re-raise: a fully graceful SIGTERM
            # produces return code 0, which the supervisor can verify.
            with asyncio.Runner() as runner:
                diagnostics = runner.run(_serve_and_observe(server))
        except BaseException:
            diagnostics["launcher_failed"] = True
        diagnostics["worker_stop_failed"] = worker_stop_failed
        shutdown_complete = not any(diagnostics.values())
        _write_report(report_path, {
            "launch_id": launch_id,
            "pid": os.getpid(),
            "shutdown_complete": shutdown_complete,
            **diagnostics,
        })
        return 0 if shutdown_complete else 1
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--app-dir", type=Path, required=True)
    parser.add_argument("--app", default="app.main:app")
    parser.add_argument("--drain-report", type=Path, required=True)
    parser.add_argument("--launch-id", required=True)
    arguments = parser.parse_args(argv)
    sys.path.insert(0, str(arguments.app_dir))
    server = uvicorn.Server(uvicorn.Config(
        arguments.app,
        host=arguments.host,
        port=arguments.port,
        lifespan="on",
    ))
    return _run_backend(server, arguments.drain_report, arguments.launch_id)


if __name__ == "__main__":
    raise SystemExit(main())
