"""No-Postgres regression for the current-password vs session contract."""
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock
import uuid

import pytest

from app.exceptions import AKBError
from app.services import auth_service as auth


class Connection:
    def __init__(self):
        self.fetchrow = AsyncMock(return_value={
            "password_hash": "stored-hash", "auth_provider": "local",
            "account_status": "active", "account_kind": "human",
        })
        self.execute = AsyncMock()

    @asynccontextmanager
    async def transaction(self):
        yield self


class Pool:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


@pytest.mark.asyncio
async def test_wrong_current_password_never_updates_or_revokes_valid_session(monkeypatch):
    conn = Connection()
    monkeypatch.setattr(auth, "require_local_auth_enabled", lambda: None)
    monkeypatch.setattr(auth, "get_pool", AsyncMock(return_value=Pool(conn)))
    monkeypatch.setattr(auth, "verify_password_async", AsyncMock(return_value=False))
    revoke = AsyncMock()
    monkeypatch.setattr(auth, "_revoke_sessions_in_conn", revoke)
    with pytest.raises(AKBError) as error:
        await auth.change_password(str(uuid.uuid4()), "wrong", "new-password-123")
    assert error.value.status_code == 400
    assert error.value.code == "current_password_incorrect"
    conn.execute.assert_not_awaited()
    revoke.assert_not_awaited()


@pytest.mark.asyncio
async def test_success_replaces_password_and_revokes_local_generation_in_same_transaction(monkeypatch):
    conn = Connection()
    uid = str(uuid.uuid4())
    monkeypatch.setattr(auth, "require_local_auth_enabled", lambda: None)
    monkeypatch.setattr(auth, "get_pool", AsyncMock(return_value=Pool(conn)))
    monkeypatch.setattr(auth, "verify_password_async", AsyncMock(side_effect=[True, False]))
    monkeypatch.setattr(auth, "hash_password_async", AsyncMock(return_value="new-hash"))
    revoke = AsyncMock()
    monkeypatch.setattr(auth, "_revoke_sessions_in_conn", revoke)
    monkeypatch.setattr(auth, "emit_event", AsyncMock())
    await auth.change_password(uid, "old", "new-password-123")
    assert "credential_change_required = false" in conn.execute.await_args.args[0]
    assert conn.execute.await_args.args[1:] == ("new-hash", uuid.UUID(uid))
    revoke.assert_awaited_once_with(conn, uuid.UUID(uid), actor_id=uid, reason=auth.REVOKE_REASON_PASSWORD_CHANGE)
