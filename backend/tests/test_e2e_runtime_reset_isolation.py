"""Opt-in Docker regression for reset isolation, run by the E2E workflow."""

from __future__ import annotations

import asyncio
import os
import secrets
import socket
from contextlib import ExitStack

import asyncpg
import boto3
import httpx
import pytest

from tests.test_e2e_runtime_unit import COMPOSE_FILE, REPO_ROOT, E2ERuntime, RuntimeConfig


@pytest.mark.skipif(os.environ.get("AKB_TEST_RESET_ISOLATION") != "1", reason="requires isolated Docker runtime")
async def test_reset_replaces_locked_database_objects_git_and_sessions(tmp_path, monkeypatch):
    monkeypatch.setenv("AKB_E2E_USERNAME", "reset-test-" + secrets.token_hex(8))
    monkeypatch.setenv("AKB_E2E_PASSWORD", secrets.token_urlsafe(32))
    with ExitStack() as stack:
        sockets = [stack.enter_context(socket.socket()) for _ in range(5)]
        for listener in sockets:
            listener.bind(("127.0.0.1", 0))
        app, embed, fixture, postgres, minio = [listener.getsockname()[1] for listener in sockets]
    runtime = E2ERuntime(RuntimeConfig(
        checkout=REPO_ROOT, runtime_root=tmp_path / "runtime", mode="serve",
        compose_file=COMPOSE_FILE, compose_project="akb-reset-test-" + secrets.token_hex(6),
        app_port=app, embed_port=embed, fixture_port=fixture,
        postgres_port=postgres, minio_port=minio, profile="transport-proxy",
    ))
    old_db = None
    try:
        await runtime.prepare()
        old_db = await asyncpg.connect(
            host="127.0.0.1", port=postgres, user="akb", password="akb", database="akb",  # pragma: allowlist secret
        )
        await old_db.execute("CREATE TABLE reset_sentinel(value text)")
        await old_db.execute("BEGIN")
        await old_db.execute("INSERT INTO reset_sentinel VALUES ('previous-generation')")
        await old_db.execute("LOCK TABLE chunks IN ROW EXCLUSIVE MODE")
        old_git = runtime.config.vault_dir
        (old_git / "reset-sentinel").write_text("previous-generation")
        old_pat = runtime._pat_value
        old_stdio = runtime._children["stdio"].process.pid
        old_identity = runtime._dependency_identity
        s3 = boto3.client(
            "s3", endpoint_url=runtime.config.minio_origin,
            aws_access_key_id="akb-ci", aws_secret_access_key="akb-ci-secret",  # pragma: allowlist secret
        )
        await asyncio.to_thread(s3.put_object, Bucket="akb-files", Key="reset-sentinel", Body=b"old")

        # Exercise the actual control endpoint, including its ready response.
        async with httpx.AsyncClient(timeout=210) as client:
            response = await client.post(runtime.config.fixture_origin + "/reset", json={"scenario": "empty"})
            assert response.status_code == 200
            assert response.json()["status"] == "ready"

        assert old_db.is_closed()
        new_db = await asyncpg.connect(
            host="127.0.0.1", port=postgres, user="akb", password="akb", database="akb",  # pragma: allowlist secret
        )
        try:
            assert await new_db.fetchval("SELECT to_regclass('public.reset_sentinel') IS NULL")
            assert await new_db.fetchval("SELECT count(*) FROM bm25_vocab_epoch") == 1
            assert await new_db.fetchval("SELECT epoch FROM bm25_vocab_epoch") == 0
        finally:
            await new_db.close()
        assert runtime._dependency_identity != old_identity
        assert runtime.config.vault_dir != old_git
        # A detached old Git operation can only write its retired path.
        (old_git / "late-write").write_text("completed after reset")
        assert not (runtime.config.vault_dir / "late-write").exists()
        assert not (runtime.config.vault_dir / "reset-sentinel").exists()
        objects = await asyncio.to_thread(s3.list_objects_v2, Bucket="akb-files")
        assert not any(item["Key"] == "reset-sentinel" for item in objects.get("Contents", []))
        assert runtime._pat_value != old_pat
        assert runtime._children["stdio"].process.pid != old_stdio
        assert runtime._stdio_initialize_observed
        assert runtime.fixture_health()["status"] == "ready"

        # Verify the backend actually loaded the new generation's config, not
        # just that the supervisor computed a different directory name.
        async with httpx.AsyncClient(
            base_url=runtime.config.app_origin,
            headers={"Authorization": "Bearer " + runtime._pat_value}, timeout=30,
        ) as client:
            response = await client.post("/api/v1/vaults", params={"name": "reset-generation-check"})
            response.raise_for_status()
            response = await client.post("/api/v1/documents", json={
                "vault": "reset-generation-check", "collection": "checks", "title": "generation",
                "content": "New generation document.", "type": "note", "tags": [],
            })
            response.raise_for_status()
        assert (runtime.config.vault_dir / "reset-generation-check.git" / "HEAD").is_file()
        assert not (old_git / "reset-generation-check.git").exists()
    finally:
        if old_db is not None and not old_db.is_closed():
            await old_db.close(timeout=2)
        await runtime.cleanup()
