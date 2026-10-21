"""Real-PostgreSQL regressions for graph node and relation labels (titles).

The DB-free half is ``test_graph_node_labels_unit.py``. What only a database can
settle is here.

The reported bug: ``/graph`` (neighbourhood and vault overview), ``/graph/overview``,
``akb_graph``, ``/relations`` and ``akb_relations`` named every document by its
collection path and file name even though it had a real title. The lookup behind
them read the legacy ``documents`` catalog alone. A document written by the
native ledger has no row there, so on a ``postgres_native`` installation every
document missed and fell back to its path. The same assertions run against both
document authorities below; the ``native`` run is the one that failed before the
lookup learned to read the head revision's frontmatter.

* a document is named by its title, and also carries ``title`` / ``doc_type`` /
  ``tags`` / ``path``; a document with no title keeps its path as ``name`` and
  states no ``title``; tables and files keep their name;
* the lookup is one batched statement per call — a graph of 25 neighbours costs
  the same as one of 3;
* a native vault is read through the head revision, a document migrated at
  cutover may lean on its retained catalog row for what its body does not say,
  and a pre-cutover document only the catalog holds still resolves;
* one vault's titles never name another vault's documents.

The legacy arm runs on the schema ``init.sql`` builds; the native arm needs the
native ledger, so it gets a fresh database with the migrations real writes meet
(the helper the derived-pipeline tests use). Set ``AKB_TEST_DSN`` to a
PostgreSQL 16 + pgvector instance whose user can create databases;
``REQUIRE_REAL_PG=1`` turns a missing instance from a skip into a failure.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import asyncpg
import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from app.config import settings

# Importing the MCP server builds the revision backend, which creates its Git
# storage directory; point it somewhere writable before that import.
settings.git_storage_path = tempfile.mkdtemp(prefix="akb-graph-labels-pg-")

from app.api.deps import get_current_user
from app.api.routes import knowledge
from app.services import document_counters, kg_service
from app.services.document_service import _compose_markdown
from app.services.m1_pg_body_store import M1PgBodyStore
from app.services.native_revision_service import NativeRevisionService
from app.services.uri_service import doc_uri, file_uri, table_uri
from mcp_server import server
from tests.concurrency.test_native_derived_pipeline import _fresh_database

pytestmark = pytest.mark.asyncio

_BACKEND = Path(__file__).resolve().parents[1]
_DSN = os.environ.get(
    "AKB_TEST_DSN",
    "postgresql://akb:akb@localhost:15432/akb",  # pragma: allowlist secret
)

A, B, C = "specs/a.md", "specs/b.md", "notes/c.md"


# ── Worlds: one vault on each document authority ─────────────────────────


class _CountingConnection:
    """Records every statement a call issues, then forwards it unchanged."""

    def __init__(self, conn: asyncpg.Connection, log: list[str]) -> None:
        self._conn = conn
        self._log = log

    def __getattr__(self, name: str):
        attr = getattr(self._conn, name)
        if name not in {"fetch", "fetchrow", "fetchval", "execute"}:
            return attr

        async def _recorded(query: str, *args: Any, **kwargs: Any):
            self._log.append(query)
            return await attr(query, *args, **kwargs)

        return _recorded


class _CountingAcquire:
    def __init__(self, inner, log: list[str]) -> None:
        self._inner = inner
        self._log = log

    async def __aenter__(self):
        return _CountingConnection(await self._inner.__aenter__(), self._log)

    async def __aexit__(self, *exc):
        return await self._inner.__aexit__(*exc)


class _CountingPool:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool
        self.statements: list[str] = []

    def acquire(self):
        return _CountingAcquire(self._pool.acquire(), self.statements)

    def __getattr__(self, name: str):
        return getattr(self._pool, name)

    def label_statements(self) -> list[str]:
        """The statements that look a document up by path (the label lookups)."""
        return [s for s in self.statements if "FROM documents" in s or ("native_resources" in s and "unnest" in s)]


@dataclass
class World:
    authority: str  # "legacy" | "native"
    pool: asyncpg.Pool
    vault: str
    vault_id: uuid.UUID
    native: NativeRevisionService | None = None
    resource_ids: dict[str, uuid.UUID] = field(default_factory=dict)
    counting: _CountingPool | None = None

    def uri(self, path: str) -> str:
        return doc_uri(self.vault, path)

    async def add_doc(
        self, path: str, title: str | None = "", doc_type: str | None = None, tags: list[str] | None = None,
        *, vault_id: uuid.UUID | None = None, **frontmatter: Any,
    ) -> None:
        """A document with the given metadata on this world's authority.

        ``title=""`` (the default) is a document that has none: the legacy row
        stores an empty title, the native body states no ``title``.
        """
        vault_id = vault_id or self.vault_id
        if self.authority == "legacy":
            async with self.pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO documents (id, vault_id, path, title, doc_type, tags) VALUES ($1, $2, $3, $4, $5, $6)",
                    uuid.uuid4(), vault_id, path, title or "", doc_type, tags,
                )
            return
        assert self.native is not None
        meta: dict[str, Any] = dict(frontmatter)
        if title:
            meta["title"] = title
        if doc_type is not None:
            meta["type"] = doc_type
        if tags is not None:
            meta["tags"] = tags
        created = await self.native.create_text(
            namespace_id=vault_id, surface="document", path=path,
            payload=_compose_markdown(meta, f"body of {path}"), actor="labels-test", mutation_id=uuid.uuid4(),
        )
        self.resource_ids[path] = created.resource_id

    async def link(self, source: str, target: str, relation: str = "related_to", **kwargs: Any) -> dict:
        result = await kg_service.link_resources(
            self.vault, source if source.startswith("akb://") else self.uri(source),
            target if target.startswith("akb://") else self.uri(target), relation, **kwargs,
        )
        assert result.get("linked") is True, result
        return result

    async def graph(self, path: str, **kwargs: Any) -> dict:
        return await kg_service.get_graph(self.vault, self.uri(path), vault_id=self.vault_id, **kwargs)

    async def relations(self, path: str, **kwargs: Any) -> list[dict]:
        return await kg_service.get_resource_relations(
            self.vault, self.uri(path), vault_id=self.vault_id, **kwargs,
        )

    def counted(self) -> _CountingPool:
        assert self.counting is not None
        self.counting.statements.clear()
        return self.counting


async def _can_connect() -> bool:
    try:
        conn = await asyncpg.connect(_DSN, timeout=2.0)
    except (OSError, asyncpg.PostgresError):
        return False
    await conn.close()
    return True


async def _make_vault(pool: asyncpg.Pool, name: str) -> uuid.UUID:
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO vaults (name, git_path) VALUES ($1, $2) RETURNING id", name, f"/tmp/{name}.git",
        )


def _route_through(monkeypatch, pool: asyncpg.Pool) -> _CountingPool:
    counting = _CountingPool(pool)

    async def _get_pool():
        return counting

    monkeypatch.setattr(kg_service, "get_pool", _get_pool)
    return counting


@pytest_asyncio.fixture
async def legacy_pool():
    if not await _can_connect():
        if os.environ.get("REQUIRE_REAL_PG") == "1":
            pytest.fail(f"REQUIRE_REAL_PG=1 but Postgres is not reachable at {_DSN}")
        pytest.skip(f"Postgres not reachable at {_DSN}")
    pool = await asyncpg.create_pool(dsn=_DSN, min_size=1, max_size=4)
    async with pool.acquire() as conn:
        await conn.execute((_BACKEND / "app" / "db" / "init.sql").read_text())
    try:
        yield pool
    finally:
        await pool.close()


@pytest_asyncio.fixture(params=["legacy", "native"])
async def world(request, monkeypatch):
    """One vault on each document authority; the assertions are shared."""
    authority = request.param
    monkeypatch.setattr(document_counters, "native_documents_are_authoritative", lambda: authority == "native")

    if authority == "legacy":
        if not await _can_connect():
            if os.environ.get("REQUIRE_REAL_PG") == "1":
                pytest.fail(f"REQUIRE_REAL_PG=1 but Postgres is not reachable at {_DSN}")
            pytest.skip(f"Postgres not reachable at {_DSN}")
        pool = await asyncpg.create_pool(dsn=_DSN, min_size=1, max_size=4)
        async with pool.acquire() as conn:
            await conn.execute((_BACKEND / "app" / "db" / "init.sql").read_text())
        name = f"_test_labels_{uuid.uuid4().hex[:8]}"
        vault_id = await _make_vault(pool, name)
        built = World("legacy", pool, name, vault_id)
        built.counting = _route_through(monkeypatch, pool)
        try:
            yield built
        finally:
            async with pool.acquire() as conn:
                await conn.execute("DELETE FROM vaults WHERE id = $1", vault_id)
            await pool.close()
        return

    async with _fresh_database() as pool:
        name = f"labels-{uuid.uuid4().hex[:8]}"
        vault_id = await _make_vault(pool, name)
        built = World("native", pool, name, vault_id, native=NativeRevisionService(pool, payload_store=M1PgBodyStore(pool)))
        built.counting = _route_through(monkeypatch, pool)
        yield built


# ── The reported bug, on each authority ──────────────────────────────────


async def test_the_neighbourhood_names_documents_by_their_title(world):
    await world.add_doc(A, "Alpha design", "spec", ["graph", "design"])
    await world.add_doc(B, "Beta notes", "note", ["notes"])
    await world.link(A, B)

    graph = await world.graph(A, hops=1)

    by_uri = {n["uri"]: n for n in graph["nodes"]}
    assert by_uri[world.uri(A)]["name"] == "Alpha design"  # was "specs/a.md"
    assert by_uri[world.uri(B)]["name"] == "Beta notes"  # was "specs/b.md"
    assert {k: by_uri[world.uri(A)][k] for k in ("title", "doc_type", "tags", "path", "depth")} == {
        "title": "Alpha design", "doc_type": "spec", "tags": ["graph", "design"], "path": A, "depth": 0,
    }
    assert {k: by_uri[world.uri(B)][k] for k in ("title", "doc_type", "tags", "path", "depth")} == {
        "title": "Beta notes", "doc_type": "note", "tags": ["notes"], "path": B, "depth": 1,
    }


async def test_the_vault_overview_names_documents_by_their_title(world):
    await world.add_doc(A, "Alpha design", "spec", ["graph"])
    await world.add_doc(B, "Beta notes")
    await world.link(A, B)

    overview = await kg_service.get_overview(world.vault, vault_id=world.vault_id, include_orphans=False)
    whole_vault = await kg_service.get_graph(world.vault, None, vault_id=world.vault_id)

    for payload in (overview, whole_vault):
        by_uri = {n["uri"]: n for n in payload["nodes"]}
        assert by_uri[world.uri(A)]["name"] == "Alpha design"
        assert by_uri[world.uri(B)]["name"] == "Beta notes"
        assert (by_uri[world.uri(A)]["doc_type"], by_uri[world.uri(A)]["tags"]) == ("spec", ["graph"])
        assert by_uri[world.uri(A)]["degree"] == 1  # existing fields are untouched
    assert overview["nodes_total"] == 2 and overview["truncated"] is False


async def test_a_relation_row_names_the_other_end_by_its_title(world):
    await world.add_doc(A, "Alpha design", "spec")
    await world.add_doc(B, "Beta notes", "note", ["n"])
    await world.link(A, B)

    (outgoing,) = await world.relations(A)
    (incoming,) = await world.relations(B)

    assert outgoing["uri"] == world.uri(B)
    assert (outgoing["name"], outgoing["title"], outgoing["doc_type"], outgoing["tags"], outgoing["path"]) == (
        "Beta notes", "Beta notes", "note", ["n"], B,
    )
    assert incoming["uri"] == world.uri(A)
    assert (incoming["name"], incoming["title"], incoming["doc_type"]) == ("Alpha design", "Alpha design", "spec")
    # The row's own fields are untouched.
    assert (outgoing["direction"], outgoing["relation"], outgoing["kind"], outgoing["edge_type"]) == (
        "outgoing", "related_to", "explicit", "strong",
    )


async def test_health_hubs_are_named_by_their_title(world):
    await world.add_doc(A, "Alpha design", "spec")
    for i in range(3):
        await world.add_doc(f"leaf/l{i}.md", f"Leaf {i}")
        await world.link(A, f"leaf/l{i}.md")

    health = await kg_service.get_health(world.vault, vault_id=world.vault_id, hub_threshold=3)

    (hub,) = health["hubs"]
    assert (hub["uri"], hub["name"], hub["degree"], hub["title"], hub["doc_type"]) == (
        world.uri(A), "Alpha design", 3, "Alpha design", "spec",
    )


async def test_a_document_with_no_title_keeps_its_path_as_its_name(world):
    await world.add_doc(A, "Alpha design")
    await world.add_doc(B, title="")  # no title anywhere
    await world.link(A, B)

    graph = await world.graph(A, hops=1)
    (row,) = await world.relations(A)

    untitled = next(n for n in graph["nodes"] if n["uri"] == world.uri(B))
    assert untitled["name"] == B  # today's value, unchanged
    assert "title" not in untitled
    assert (untitled["doc_type"], untitled["tags"], untitled["path"]) == ("note", [], B)
    assert row["name"] == B and "title" not in row


async def test_a_dangling_endpoint_is_named_by_its_path_and_does_not_break_the_graph(world):
    """An edge whose document went away is still served, named by its path."""
    await world.add_doc(A, "Alpha design")
    await world.add_doc(B, "Beta notes")
    await world.link(A, B)
    # The document disappears behind the edge (nothing has cleaned the edge up yet).
    if world.authority == "legacy":
        async with world.pool.acquire() as conn:
            await conn.execute("DELETE FROM documents WHERE vault_id = $1 AND path = $2", world.vault_id, B)
    else:
        assert world.native is not None
        await world.native.delete_resource(
            namespace_id=world.vault_id, surface="document", path=B, actor="labels-test",
            mutation_id=uuid.uuid4(), expected_revision_id=await _head(world, B),
        )

    graph = await world.graph(A, hops=1)

    ghost = next(n for n in graph["nodes"] if n["uri"] == world.uri(B))
    assert ghost["name"] == B
    assert set(ghost) == {"uri", "resource_type", "name", "depth", "path"}  # nothing claims it was found


async def test_tables_and_files_keep_their_name(world):
    await world.add_doc(A, "Alpha design")
    file_id = uuid.uuid4()
    async with world.pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO vault_tables (vault_id, name, description) VALUES ($1, 'metrics', 'Key metrics')", world.vault_id,
        )
        await conn.execute(
            "INSERT INTO vault_tables (vault_id, name) VALUES ($1, 'plain')", world.vault_id,
        )
        await conn.execute(
            "INSERT INTO vault_files (id, vault_id, kind, upload_state, name, s3_key) "
            "VALUES ($1, $2, 'file', 'confirmed', 'diagram.png', $3)",
            file_id, world.vault_id, f"k/{file_id}",
        )
    table_with_description, plain_table, file = table_uri(world.vault, "metrics"), table_uri(world.vault, "plain"), file_uri(world.vault, str(file_id))
    for target, relation in ((table_with_description, "references"), (plain_table, "depends_on"), (file, "attached_to")):
        await world.link(world.uri(A), target, relation)

    graph = await world.graph(A, hops=1)

    by_uri = {n["uri"]: n for n in graph["nodes"]}
    assert (by_uri[table_with_description]["name"], by_uri[table_with_description]["title"]) == ("Key metrics", "Key metrics")
    assert (by_uri[plain_table]["name"], by_uri[plain_table]["title"]) == ("plain", "plain")
    assert (by_uri[file]["name"], by_uri[file]["title"]) == ("diagram.png", "diagram.png")
    assert all("doc_type" not in by_uri[u] for u in (table_with_description, plain_table, file))


async def test_labels_never_cross_vaults(world):
    """The same path in two vaults is two documents; neither names the other."""
    other = f"{world.vault}-other"
    other_id = await _make_vault(world.pool, other)
    try:
        await world.add_doc(A, "Alpha in the first vault")
        await world.add_doc(B, "Beta in the first vault")
        await world.add_doc(A, "Alpha in the OTHER vault", vault_id=other_id)
        await world.add_doc(B, "Beta in the OTHER vault", vault_id=other_id)
        await world.link(A, B)

        graph = await world.graph(A, hops=1)
        (row,) = await world.relations(A)

        assert {n["name"] for n in graph["nodes"]} == {"Alpha in the first vault", "Beta in the first vault"}
        assert row["name"] == "Beta in the first vault"
    finally:
        async with world.pool.acquire() as conn:
            await conn.execute("DELETE FROM vaults WHERE id = $1", other_id)


# ── The statement budget ─────────────────────────────────────────────────


async def _star(world: World, hub: str, leaves: int) -> None:
    await world.add_doc(hub, f"Hub {hub}")
    for i in range(leaves):
        leaf = f"{hub.removesuffix('.md')}/leaf-{i:02d}.md"
        await world.add_doc(leaf, f"Leaf {i} of {hub}")
        await world.link(hub, leaf)


async def test_a_graph_costs_one_label_statement_and_the_same_total_however_many_nodes(world):
    """Not one lookup per node: 25 neighbours cost exactly what 3 do."""
    await _star(world, "small.md", 3)
    await _star(world, "big.md", 25)

    walked: dict[str, tuple[int, int]] = {}
    for hub, leaves in (("small.md", 3), ("big.md", 25)):
        counting = world.counted()
        graph = await world.graph(hub, hops=1, limit=50)
        assert len(graph["nodes"]) == leaves + 1
        assert {n["name"] for n in graph["nodes"]} == {f"Hub {hub}", *(f"Leaf {i} of {hub}" for i in range(leaves))}
        walked[hub] = (len(counting.statements), len(counting.label_statements()))

    assert walked["small.md"] == walked["big.md"], walked
    assert walked["big.md"][1] == 1  # one statement names every node


async def test_relations_and_the_overview_cost_one_label_statement_too(world):
    await _star(world, "small.md", 3)
    await _star(world, "big.md", 25)

    relation_statements = []
    for hub, leaves in (("small.md", 3), ("big.md", 25)):
        counting = world.counted()
        rows = await world.relations(hub)
        assert len(rows) == leaves
        assert len(counting.label_statements()) == 1
        relation_statements.append(len(counting.statements))
    assert relation_statements[0] == relation_statements[1]

    counting = world.counted()
    overview = await kg_service.get_overview(world.vault, vault_id=world.vault_id, include_orphans=False)
    assert len(overview["nodes"]) == 2 + 3 + 25
    assert len(counting.label_statements()) == 1


# ── REST and MCP, end to end ─────────────────────────────────────────────


class _FakeUser:
    user_id = "u-test"
    username = "tester"


@pytest_asyncio.fixture
async def rest(world, monkeypatch):
    async def _reader(*_args, **_kwargs):
        return {"vault_id": world.vault_id, "role": "reader", "status": "active"}

    monkeypatch.setattr(knowledge, "check_vault_access", _reader)
    app = FastAPI()
    app.include_router(knowledge.router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest_asyncio.fixture
async def mcp(world, monkeypatch):
    async def _access(*_args, **_kwargs):
        return {"vault_id": world.vault_id, "role": "reader"}

    monkeypatch.setattr(server, "check_vault_access", _access)
    user = server._MCPUser(user_id=str(uuid.uuid4()), username="tester")

    async def call(tool: str, **arguments: Any) -> dict:
        return await server._dispatch(tool, arguments, user)

    return call


async def test_rest_serves_titles_on_every_graph_and_relations_route(world, rest):
    await world.add_doc(A, "Alpha design", "spec", ["graph"])
    await world.add_doc(B, "Beta notes", "note")
    await world.link(A, B)

    neighbours = (await rest.get("/api/v1/graph", params={"uri": world.uri(A), "hops": 1})).json()
    overview = (await rest.get("/api/v1/graph/overview", params={"vault": world.vault})).json()
    whole_vault = (await rest.get("/api/v1/graph", params={"vault": world.vault})).json()
    relations = (await rest.get("/api/v1/relations", params={"uri": world.uri(A)})).json()

    assert neighbours["kind"] == "graph_neighbors"
    assert overview["kind"] == whole_vault["kind"] == "graph_overview"
    for payload in (neighbours, overview, whole_vault):
        by_uri = {n["uri"]: n for n in payload["nodes"]}
        assert by_uri[world.uri(A)]["name"] == "Alpha design"
        assert by_uri[world.uri(A)]["title"] == "Alpha design"
        assert by_uri[world.uri(A)]["doc_type"] == "spec"
        assert by_uri[world.uri(A)]["tags"] == ["graph"]
        assert by_uri[world.uri(A)]["path"] == A
        assert by_uri[world.uri(B)]["name"] == "Beta notes"
    (row,) = relations["relations"]
    assert (row["name"], row["title"], row["doc_type"], row["path"]) == ("Beta notes", "Beta notes", "note", B)


async def test_mcp_serves_titles_on_akb_graph_and_akb_relations(world, mcp):
    await world.add_doc(A, "Alpha design", "spec")
    await world.add_doc(B, "Beta notes")
    await world.link(A, B)

    neighbours = await mcp("akb_graph", uri=world.uri(A), hops=1)
    whole_vault = await mcp("akb_graph", vault=world.vault)
    relations = await mcp("akb_relations", uri=world.uri(A))

    for payload in (neighbours, whole_vault):
        assert {n["name"] for n in payload["nodes"]} == {"Alpha design", "Beta notes"}
    (row,) = relations["relations"]
    assert (row["name"], row["title"]) == ("Beta notes", "Beta notes")


# ── Legacy-only surfaces ─────────────────────────────────────────────────


@pytest_asyncio.fixture
async def legacy_world(monkeypatch, legacy_pool):
    monkeypatch.setattr(document_counters, "native_documents_are_authoritative", lambda: False)
    name = f"_test_labels_legacy_{uuid.uuid4().hex[:8]}"
    vault_id = await _make_vault(legacy_pool, name)
    built = World("legacy", legacy_pool, name, vault_id)
    built.counting = _route_through(monkeypatch, legacy_pool)
    try:
        yield built
    finally:
        async with legacy_pool.acquire() as conn:
            await conn.execute("DELETE FROM vaults WHERE id = $1", vault_id)


async def test_provenance_relations_are_titled(legacy_world):
    world = legacy_world
    await world.add_doc(A, "Alpha design")
    await world.add_doc(B, "Beta notes", "note", ["n"])
    await world.link(A, B)
    async with world.pool.acquire() as conn:
        doc_id = await conn.fetchval("SELECT id FROM documents WHERE vault_id = $1 AND path = $2", world.vault_id, A)

    provenance = await kg_service.get_provenance(str(doc_id), vault_id=world.vault_id)

    (row,) = provenance["relations"]
    assert (row["name"], row["title"], row["doc_type"], row["tags"]) == ("Beta notes", "Beta notes", "note", ["n"])


async def test_orphan_documents_in_the_overview_are_labelled_like_connected_ones(legacy_world):
    world = legacy_world
    await world.add_doc(A, "Alpha design")
    await world.add_doc(B, "Beta notes")
    await world.link(A, B)
    await world.add_doc(C, "Lonely note", "reference", ["solo"])

    overview = await kg_service.get_overview(world.vault, vault_id=world.vault_id)

    lonely = next(n for n in overview["nodes"] if n["uri"] == world.uri(C))
    assert lonely == {
        "uri": world.uri(C), "resource_type": "doc", "degree": 0, "name": "Lonely note",
        "title": "Lonely note", "doc_type": "reference", "tags": ["solo"], "path": C,
    }
    assert overview["orphans_returned"] == 1


# ── Native authority: what the head revision and the catalog each contribute ──


@pytest_asyncio.fixture
async def native_world(monkeypatch):
    monkeypatch.setattr(document_counters, "native_documents_are_authoritative", lambda: True)
    async with _fresh_database() as pool:
        name = f"labels-{uuid.uuid4().hex[:8]}"
        vault_id = await _make_vault(pool, name)
        built = World("native", pool, name, vault_id, native=NativeRevisionService(pool, payload_store=M1PgBodyStore(pool)))
        built.counting = _route_through(monkeypatch, pool)
        yield built


async def test_a_native_vault_has_no_catalog_rows_so_the_title_can_only_come_from_the_body(native_world):
    """The precondition that made the lookup miss: nothing in `documents`."""
    world = native_world
    await world.add_doc(A, "Alpha design", "spec", ["graph"])
    await world.add_doc(B, "Beta notes")
    await world.link(A, B)

    async with world.pool.acquire() as conn:
        catalog_rows = await conn.fetchval("SELECT count(*) FROM documents WHERE vault_id = $1", world.vault_id)
        native_rows = await conn.fetchval(
            "SELECT count(*) FROM native_resources WHERE namespace_id = $1 AND surface = 'document'", world.vault_id,
        )
    graph = await world.graph(A, hops=1)

    assert (catalog_rows, native_rows) == (0, 2)
    assert {n["name"] for n in graph["nodes"]} == {"Alpha design", "Beta notes"}


async def test_the_title_follows_an_edit_of_the_head_revision(native_world):
    world = native_world
    await world.add_doc(A, "First title")
    await world.add_doc(B, "Beta notes")
    await world.link(A, B)
    await world.native.replace_text(
        namespace_id=world.vault_id, surface="document", path=A,
        payload=_compose_markdown({"title": "Second title", "type": "spec"}, "edited"),
        actor="labels-test", mutation_id=uuid.uuid4(),
        expected_revision_id=(await _head(world, A)), expected_resource_id=world.resource_ids[A],
    )

    graph = await world.graph(A, hops=1)

    node = next(n for n in graph["nodes"] if n["uri"] == world.uri(A))
    assert (node["name"], node["doc_type"]) == ("Second title", "spec")


async def _head(world: World, path: str) -> str:
    async with world.pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT head_revision_id FROM native_resources WHERE namespace_id = $1 AND current_path = $2 AND lifecycle = 'live'",
            world.vault_id, path,
        )


async def _retain_catalog_row(world: World, path: str, title: str, doc_type: str | None, tags: list[str], *, resource_id) -> None:
    async with world.pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO documents (id, vault_id, path, title, doc_type, tags) VALUES ($1, $2, $3, $4, $5, $6)",
            resource_id, world.vault_id, path, title, doc_type, tags,
        )


async def test_a_retained_catalog_row_fills_what_the_preserved_body_does_not_say(native_world):
    """A document migrated at cutover: its body is byte-for-byte the Git file and
    may state no title; the catalog row it kept still does."""
    world = native_world
    await world.add_doc(A, title="", doc_type="decision")  # the body states a type, no title, no tags
    await world.add_doc(B, "Beta notes", "spec", ["fresh"])  # the body states everything
    await world.link(A, B)
    await _retain_catalog_row(world, A, "Catalog title", "note", ["from-catalog"], resource_id=world.resource_ids[A])
    await _retain_catalog_row(world, B, "Stale catalog title", "note", ["stale"], resource_id=world.resource_ids[B])

    graph = await world.graph(A, hops=1)

    by_uri = {n["uri"]: n for n in graph["nodes"]}
    a, b = by_uri[world.uri(A)], by_uri[world.uri(B)]
    assert (a["name"], a["doc_type"], a["tags"]) == ("Catalog title", "decision", ["from-catalog"])
    assert (b["name"], b["doc_type"], b["tags"]) == ("Beta notes", "spec", ["fresh"])  # the body wins


async def test_a_pre_cutover_document_only_the_catalog_holds_still_resolves(native_world):
    world = native_world
    await world.add_doc(A, "Alpha design")
    # `notes/c.md` was never copied into the ledger: the catalog is all there is.
    async with world.pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO documents (id, vault_id, path, title, doc_type, tags) VALUES ($1, $2, $3, 'Old note', 'note', '{t}')",
            uuid.uuid4(), world.vault_id, C,
        )
        await conn.execute(
            "INSERT INTO edges (vault_id, source_uri, target_uri, relation_type, source_type, target_type, kind) "
            "VALUES ($1, $2, $3, 'related_to', 'doc', 'doc', 'explicit')",
            world.vault_id, world.uri(A), world.uri(C),
        )

    graph = await world.graph(A, hops=1)

    old = next(n for n in graph["nodes"] if n["uri"] == world.uri(C))
    assert (old["name"], old["doc_type"], old["tags"]) == ("Old note", "note", ["t"])


async def test_a_catalog_row_at_a_path_a_native_resource_holds_does_not_name_it(native_world):
    """The catalog is consulted by identity once the ledger holds the path; a
    ghost row that merely shares the path must not lend its title."""
    world = native_world
    await world.add_doc(A, title="")  # native, no title in the body
    await world.add_doc(B, "Beta notes")
    await world.link(A, B)
    await _retain_catalog_row(world, A, "Ghost of another document", "note", [], resource_id=uuid.uuid4())

    graph = await world.graph(A, hops=1)

    node = next(n for n in graph["nodes"] if n["uri"] == world.uri(A))
    assert node["name"] == A and "title" not in node


async def test_a_hub_with_a_frontmatter_longer_than_the_first_read_is_still_titled(native_world):
    """Frontmatter keys sort alphabetically, so `title` follows a long `related_to`."""
    world = native_world
    children = [f"akb://{world.vault}/coll/hub/doc/child-{i:04d}.md" for i in range(300)]
    await world.add_doc("hub/index.md", "Hub index", "index", related_to=children)
    await world.add_doc(B, "Beta notes")
    await world.link("hub/index.md", B)
    async with world.pool.acquire() as conn:
        size = await conn.fetchval(
            "SELECT p.byte_size FROM native_resources r "
            "JOIN native_revisions nr ON nr.resource_id = r.resource_id AND nr.revision_id = r.head_revision_id "
            "JOIN native_payload_manifests pm ON pm.payload_manifest_id = nr.payload_manifest_id "
            "JOIN m1_reference_payloads p ON p.payload_id = pm.private_locator "
            "WHERE r.resource_id = $1",
            world.resource_ids["hub/index.md"],
        )
    assert size > 8 * 1024 + 1, "the fixture must outgrow the first read window"

    counting = world.counted()
    graph = await world.graph("hub/index.md", hops=1)

    hub = next(n for n in graph["nodes"] if n["uri"] == world.uri("hub/index.md"))
    assert (hub["name"], hub["doc_type"]) == ("Hub index", "index")
    # One wider read, for that document only.
    assert len(counting.label_statements()) == 2


async def test_a_document_without_frontmatter_is_named_by_its_path(native_world):
    world = native_world
    await world.add_doc(A, "Alpha design")
    created = await world.native.create_text(
        namespace_id=world.vault_id, surface="document", path=B,
        payload="# just a heading\n\nand prose\n", actor="labels-test", mutation_id=uuid.uuid4(),
    )
    assert created.resource_id
    await world.link(A, B)

    graph = await world.graph(A, hops=1)

    plain = next(n for n in graph["nodes"] if n["uri"] == world.uri(B))
    assert (plain["name"], plain["doc_type"], plain["tags"]) == (B, "note", [])


async def test_a_legacy_installation_does_not_read_the_native_ledger(monkeypatch, legacy_world):
    """Switching the authority off is what keeps native tables out of the query."""
    world = legacy_world
    await world.add_doc(A, "Alpha design")
    await world.add_doc(B, "Beta notes")
    await world.link(A, B)

    counting = world.counted()
    graph = await world.graph(A, hops=1)

    assert {n["name"] for n in graph["nodes"]} == {"Alpha design", "Beta notes"}
    assert not any("native_" in statement for statement in counting.statements)
