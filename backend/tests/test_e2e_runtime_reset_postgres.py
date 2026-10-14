"""Real PostgreSQL regression coverage for fixture-reset deadlocks (#686)."""

from __future__ import annotations

import asyncio
import os
import uuid

import asyncpg
import pytest

from tests.test_e2e_runtime_unit import E2ERuntime, ProvisioningFailure, make_config


@pytest.fixture
async def reset_database(monkeypatch, tmp_path):
    # Reset discovers every application table, so a private schema is insufficient.
    # Use a fresh database to avoid truncating any pre-existing test installation.
    dsn = os.environ.get("AKB_TEST_DSN", "postgresql://akb:akb@localhost:15432/akb")
    connect = asyncpg.connect
    try:
        admin = await connect(dsn, timeout=2)
    except (OSError, asyncpg.PostgresError):
        if os.environ.get("REQUIRE_REAL_PG") == "1":
            pytest.fail("REQUIRE_REAL_PG=1 but PostgreSQL is unavailable at AKB_TEST_DSN")
        pytest.skip("PostgreSQL unavailable at AKB_TEST_DSN")
    database = "reset_regression_" + uuid.uuid4().hex
    connections = []
    created = False
    try:
        try:
            await admin.execute(f'CREATE DATABASE "{database}"')
            created = True
        except asyncpg.InsufficientPrivilegeError:
            if os.environ.get("REQUIRE_REAL_PG") == "1":
                pytest.fail("Reset regression tests require CREATE DATABASE privilege")
            pytest.skip("Reset regression tests require CREATE DATABASE privilege")

        async def open_connection(**settings):
            conn = await connect(
                dsn, database=database, timeout=2,
                server_settings={"statement_timeout": "5000", **settings},
            )
            connections.append(conn)
            return conn

        observer = await open_connection()
        await observer.execute("""
            CREATE TABLE users (id integer PRIMARY KEY, username text NOT NULL);
            CREATE TABLE tokens (id integer PRIMARY KEY, user_id integer REFERENCES users);
            CREATE TABLE app_a (id serial PRIMARY KEY, value text);
            CREATE TABLE app_b (id serial PRIMARY KEY, value text);
            INSERT INTO users VALUES (1, 'fixture-user'), (2, 'ephemeral-user');
            INSERT INTO tokens VALUES (1, 1), (2, 2);
            INSERT INTO app_a (value) VALUES ('existing-a');
            INSERT INTO app_b (value) VALUES ('existing-b');
        """)
        monkeypatch.setenv("TEST_USERNAME_ENV", "fixture-user")
        monkeypatch.setenv("TEST_PASSWORD_ENV", "fixture-password")
        yield E2ERuntime(make_config(tmp_path)), observer, open_connection
    finally:
        for conn in connections:
            if not conn.is_closed():
                await conn.close(timeout=2)
        if created:
            await admin.execute(f'DROP DATABASE "{database}" WITH (FORCE)')
        await admin.close(timeout=2)


async def _wait_for_lock_wait(observer, pid):
    async with asyncio.timeout(3):
        while not await observer.fetchval(
            "SELECT EXISTS (SELECT FROM pg_locks WHERE pid = $1 AND NOT granted)", pid,
        ):
            await asyncio.sleep(0.01)


async def test_reset_retries_real_deadlock_within_one_call(reset_database, monkeypatch):
    runtime, observer, open_connection = reset_database
    # Only the reset backend runs deadlock detection while the cycle exists.
    # This makes reset (rather than writer) the deterministic deadlock victim.
    try:
        writer = await open_connection(deadlock_timeout="10s")
        reset = await open_connection(deadlock_timeout="50ms")
    except asyncpg.InsufficientPrivilegeError:
        if os.environ.get("REQUIRE_REAL_PG") == "1":
            pytest.fail("Reset deadlock test requires permission to set deadlock_timeout")
        pytest.skip("Reset deadlock test requires permission to set deadlock_timeout")
    writer_pid = writer.get_server_pid()
    reset_holds_a = asyncio.Event()
    allow_truncate = asyncio.Event()
    attempts = []
    failures = []
    connect_calls = []

    class ScheduledConnection:
        def transaction(self):
            return reset.transaction()

        async def execute(self, sql, *args):
            if "DO $cleanup$" in sql:
                attempts.append(sql)
                if len(attempts) == 1:
                    # Schedule the conflicting lock order, without replacing or
                    # simulating production cleanup SQL or PostgreSQL errors.
                    await reset.execute("LOCK TABLE app_a IN ACCESS EXCLUSIVE MODE")
                    reset_holds_a.set()
                    await allow_truncate.wait()
            try:
                return await reset.execute(sql, *args)
            except asyncpg.PostgresError as exc:
                failures.append(exc.sqlstate)
                raise

        async def close(self):
            await reset.close(timeout=2)

    async def runtime_connect(**kwargs):
        connect_calls.append(kwargs)
        return ScheduledConnection()

    monkeypatch.setattr(asyncpg, "connect", runtime_connect)

    async def write_in_reverse_order():
        async with writer.transaction():
            await writer.execute("LOCK TABLE app_b IN ROW EXCLUSIVE MODE")
            await reset_holds_a.wait()
            await writer.execute("INSERT INTO app_a (value) VALUES ('in-flight-writer')")
            await writer.execute("INSERT INTO app_b (value) VALUES ('in-flight-writer')")

    writer_task = asyncio.create_task(write_in_reverse_order())
    reset_task = None
    try:
        # Ensure B is already held before starting reset.
        async with asyncio.timeout(3):
            while not await observer.fetchval(
                """SELECT EXISTS (SELECT FROM pg_locks
                    WHERE pid = $1 AND relation = 'app_b'::regclass
                    AND mode = 'RowExclusiveLock' AND granted)""", writer_pid,
            ):
                await asyncio.sleep(0.01)
        reset_task = asyncio.create_task(runtime._reset_postgres_in_place())
        await asyncio.wait_for(reset_holds_a.wait(), timeout=3)
        await _wait_for_lock_wait(observer, writer_pid)
        allow_truncate.set()
        await asyncio.wait_for(asyncio.gather(reset_task, writer_task), timeout=8)
    finally:
        for task in (reset_task, writer_task):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(task for task in (reset_task, writer_task) if task is not None),
            return_exceptions=True,
        )

    assert failures == ["40P01"]
    assert len(attempts) == 2
    assert len(connect_calls) == 1
    assert reset.is_closed()
    assert await observer.fetchval("SELECT count(*) FROM app_a") == 0
    assert await observer.fetchval("SELECT count(*) FROM app_b") == 0
    assert [tuple(row) for row in await observer.fetch("SELECT * FROM users")] == [(1, "fixture-user")]
    assert [tuple(row) for row in await observer.fetch("SELECT * FROM tokens")] == [(1, 1)]
    assert await observer.fetchval("INSERT INTO app_a (value) VALUES ('new') RETURNING id") == 1


async def test_later_cleanup_failure_rolls_back_truncate_and_token_delete(reset_database, monkeypatch):
    runtime, observer, open_connection = reset_database
    await observer.execute("""
        CREATE FUNCTION reject_user_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'deliberate user cleanup failure' USING ERRCODE = 'P0001';
        END;
        $$;
        CREATE TRIGGER reject_cleanup BEFORE DELETE ON users
            FOR EACH ROW EXECUTE FUNCTION reject_user_cleanup();
    """)
    reset = await open_connection()
    cleanup_attempts = []

    class ObservedConnection:
        def transaction(self):
            return reset.transaction()

        async def execute(self, sql, *args):
            if "DO $cleanup$" in sql:
                cleanup_attempts.append(sql)
            return await reset.execute(sql, *args)

        async def close(self):
            await reset.close(timeout=2)

    async def runtime_connect(**_kwargs):
        return ObservedConnection()

    monkeypatch.setattr(asyncpg, "connect", runtime_connect)
    with pytest.raises(ProvisioningFailure, match="P0001.*deliberate user cleanup failure"):
        await asyncio.wait_for(runtime._reset_postgres_in_place(), timeout=5)

    assert len(cleanup_attempts) == 1
    assert reset.is_closed()
    assert await observer.fetchval("SELECT count(*) FROM app_a") == 1
    assert await observer.fetchval("SELECT count(*) FROM app_b") == 1
    assert await observer.fetchval("SELECT count(*) FROM tokens") == 2
    assert await observer.fetchval("SELECT count(*) FROM users") == 2
    # RESTART IDENTITY is also rolled back when the later DELETE fails.
    assert await observer.fetchval("INSERT INTO app_a (value) VALUES ('new') RETURNING id") == 2
