"""Public policy must not mask stronger member authority on info/read checks."""

from datetime import datetime, timezone
import uuid
from unittest.mock import AsyncMock

import pytest

from app.exceptions import ForbiddenError
from app.models.vault_scope import VaultScope, current_vault_scope
from app.services import access_service

ACTOR = uuid.UUID("00000000-0000-0000-0000-000000000001")
OWNER = uuid.UUID("00000000-0000-0000-0000-000000000002")
VAULT = uuid.UUID("00000000-0000-0000-0000-000000000003")


class Connection:
    def __init__(self):
        self.vault = {
            "id": VAULT, "name": "public-vault", "owner_id": OWNER,
            "status": "active", "public_access": "reader", "description": "",
            "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        }
        self.member_role = None
        self.is_admin = False
        self.is_mirror = False

    async def fetchrow(self, query, *args):
        if "FROM vaults" in query:
            return self.vault
        if "FROM vault_access" in query:
            return {"role": self.member_role} if self.member_role else None
        if "FROM users" in query:
            return {"username": "vault-owner", "display_name": "Vault Owner"}
        if "FROM documents" in query or "FROM native_documents" in query:
            return None
        raise AssertionError(query)

    async def fetchval(self, query, *args):
        if "SELECT is_admin FROM users" in query:
            return self.is_admin
        if "SELECT 1 FROM vault_external_git" in query:
            return self.is_mirror
        if "COUNT(*)" in query:
            return 0
        raise AssertionError(query)


class Acquisition:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_):
        return False


class Pool:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        return Acquisition(self.connection)


@pytest.fixture
def connection(monkeypatch):
    connection = Connection()
    monkeypatch.setattr(access_service, "get_pool", AsyncMock(return_value=Pool(connection)))
    monkeypatch.setattr(access_service.write_policy_repo, "get_policy", AsyncMock(return_value=None))
    access_service.reset_authorized_vault()
    yield connection
    access_service.reset_authorized_vault()


@pytest.mark.parametrize("authority", ["documents", "native_documents"])
@pytest.mark.parametrize("public,member,role,source", [
    ("reader", "writer", "writer", "member"),
    ("reader", "admin", "admin", "member"),
    ("writer", "reader", "writer", "public"),
    ("reader", None, "reader", "public"),
    ("reader", "reader", "reader", "member"),
])
async def test_info_and_access_report_highest_role(connection, monkeypatch, authority, public, member, role, source):
    connection.vault["public_access"] = public
    connection.member_role = member
    monkeypatch.setattr(access_service.document_counters, "vault_document_count_sql", lambda: f"SELECT COUNT(*) FROM {authority}")
    monkeypatch.setattr(access_service.document_counters, "vault_last_activity_sql", lambda: f"SELECT updated_at FROM {authority}")

    info = await access_service.get_vault_info(str(ACTOR), "public-vault")
    assert (info["role"], info["role_source"]) == (role, source)
    assert info["public_access"] == public
    for required in ("reader", "writer", "admin"):
        if access_service.ROLE_HIERARCHY[required] <= access_service.ROLE_HIERARCHY[role]:
            access = await access_service.check_vault_access(str(ACTOR), "public-vault", required)
            assert (access["role"], access["role_source"]) == (role, source)
            assert access_service.authorized_vault_id() == str(VAULT)
        else:
            with pytest.raises(ForbiddenError):
                await access_service.check_vault_access(str(ACTOR), "public-vault", required)


@pytest.mark.parametrize("system_admin", [False, True])
async def test_owner_and_system_admin_precedence_is_preserved(connection, system_admin):
    connection.member_role = "reader"
    connection.is_admin = system_admin
    actor = ACTOR if system_admin else OWNER
    access = await access_service.check_vault_access(str(actor), "public-vault", "owner")
    assert access["role"] == "owner"
    assert access["role_source"] == ("system_admin" if system_admin else "member")
    info = await access_service.get_vault_info(str(actor), "public-vault")
    assert info["role"] == ("admin" if system_admin else "owner")


@pytest.mark.parametrize("actor", [ACTOR, OWNER])
@pytest.mark.parametrize("required", ["writer", "admin"])
async def test_archive_still_blocks_membership_and_content_mutations(connection, actor, required):
    connection.member_role = "admin"
    connection.vault.update(public_access="writer", status="archived")
    with pytest.raises(ForbiddenError, match="archived \\(read-only\\)"):
        await access_service.check_vault_access(str(actor), "public-vault", required)
    assert access_service.authorized_vault() is None
    assert (await access_service.check_vault_access(str(actor), "public-vault"))["status"] == "archived"


async def test_archived_owner_transfer_check_remains_separately_allowed(connection):
    connection.vault["status"] = "archived"
    assert (await access_service.check_vault_access(str(OWNER), "public-vault", "owner"))["role"] == "owner"


async def test_public_writer_does_not_escape_mirror_scope_or_managed_write_guards(connection, monkeypatch):
    connection.vault["public_access"] = "writer"
    connection.member_role = "admin"
    connection.is_mirror = True
    with pytest.raises(ForbiddenError, match="external git mirror"):
        await access_service.check_vault_access(str(ACTOR), "public-vault", "writer")

    connection.is_mirror = False
    token = current_vault_scope.set(VaultScope(prefixes=(), extra_vaults=frozenset({"another-vault"})))
    try:
        with pytest.raises(ForbiddenError, match="Token scope"):
            await access_service.check_vault_access(str(ACTOR), "public-vault", "writer")
    finally:
        current_vault_scope.reset(token)

    monkeypatch.setattr(access_service.write_policy_repo, "get_policy", AsyncMock(return_value={"managed_by": "collector"}))
    with pytest.raises(ForbiddenError, match="write-managed by collector"):
        await access_service.check_vault_access(str(ACTOR), "public-vault", "writer")
    assert access_service.authorized_vault() is None
