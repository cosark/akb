"""Real-PostgreSQL regressions for the strength-aware neighbourhood walk.

The DB-free half is ``test_graph_strong_walk_unit.py``. What only a database can
settle is here: that the SQL fragment ``edge_strength_sql`` selects exactly the
rows ``resolve_edge_type`` would serve as that strength — for every shape the
``edges.kind`` / ``edges.metadata`` pair can take, including the legacy ones
(no key, a NULL or non-object ``metadata``, a value outside the vocabulary, a
stray key on an implicit row) — and that the BFS spends its ``limit`` node cap
on the neighbours it was asked for.

``edge_type=strong`` walks and returns only strong edges, in both directions; a
neighbour reachable only through a weak edge is never visited. ``weak`` is the
mirror image; omitted means every edge, as before. The vault overview is not
strength-aware and is left exactly as it was.

Set ``AKB_TEST_DSN`` to a PostgreSQL 16 + pgvector instance; ``REQUIRE_REAL_PG=1``
turns a missing instance from a skip into a failure.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from dataclasses import dataclass
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
settings.git_storage_path = tempfile.mkdtemp(prefix="akb-strong-walk-pg-")

from app.api.deps import get_current_user
from app.api.routes import knowledge
from app.services import document_counters, kg_service
from app.services.kg_service import resolve_edge_type, store_document_relations
from app.services.uri_service import doc_uri
from mcp_server import server

pytestmark = pytest.mark.asyncio

_BACKEND = Path(__file__).resolve().parents[1]
_DSN = os.environ.get(
    "AKB_TEST_DSN",
    "postgresql://akb:akb@localhost:15432/akb",  # pragma: allowlist secret
)


async def _can_connect() -> bool:
    try:
        conn = await asyncpg.connect(_DSN, timeout=2.0)
    except (OSError, asyncpg.PostgresError):
        return False
    await conn.close()
    return True


@pytest_asyncio.fixture
async def pool():
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


@dataclass
class World:
    pool: asyncpg.Pool
    vault: str
    vault_id: uuid.UUID

    def uri(self, name: str) -> str:
        return doc_uri(self.vault, f"n/{name}.md")

    async def docs(self, *names: str) -> None:
        async with self.pool.acquire() as conn:
            for name in names:
                await conn.execute(
                    "INSERT INTO documents (id, vault_id, path, title) VALUES ($1, $2, $3, $4)",
                    uuid.uuid4(), self.vault_id, f"n/{name}.md", f"Title of {name}",
                )

    async def link(self, source: str, target: str, relation: str = "related_to", **kwargs: Any) -> None:
        result = await kg_service.link_resources(
            self.vault, self.uri(source), self.uri(target), relation, **kwargs,
        )
        assert result.get("linked") is True, result

    async def seed_edge(
        self, source: str, target: str, *, kind: str = "explicit", metadata: str | None = "{}",
        relation: str | None = None,
    ) -> None:
        """Insert a row exactly as an older release (or a bare writer) would have."""
        relation = relation or ("links_to" if kind == "implicit" else "related_to")
        async with self.pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO edges (vault_id, source_uri, target_uri, relation_type, source_type, target_type, "
                "metadata, kind) VALUES ($1, $2, $3, $4, 'doc', 'doc', $5::jsonb, $6)",
                self.vault_id, self.uri(source), self.uri(target), relation, metadata, kind,
            )

    async def extract(self, source: str, *, body: str = "") -> None:
        """Run the implicit extraction a document write runs for ``source``."""
        async with self.pool.acquire() as conn:
            await store_document_relations(conn, self.vault_id, self.vault, f"n/{source}.md", [], [], [], body)

    async def walk(self, name: str, **kwargs: Any) -> dict:
        return await kg_service.get_graph(self.vault, self.uri(name), vault_id=self.vault_id, **kwargs)

    def names(self, graph: dict) -> set[str]:
        prefix = f"akb://{self.vault}/coll/n/doc/"
        return {n["uri"].removeprefix(prefix).removesuffix(".md") for n in graph["nodes"]}


@pytest_asyncio.fixture
async def world(pool, monkeypatch):
    name = f"_test_strong_walk_{uuid.uuid4().hex[:8]}"
    async with pool.acquire() as conn:
        vault_id = await conn.fetchval(
            "INSERT INTO vaults (name, git_path) VALUES ($1, $2) RETURNING id", name, f"/tmp/{name}.git",
        )

    async def _get_pool():
        return pool

    monkeypatch.setattr(kg_service, "get_pool", _get_pool)
    monkeypatch.setattr(document_counters, "native_documents_are_authoritative", lambda: False)
    try:
        yield World(pool=pool, vault=name, vault_id=vault_id)
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM vaults WHERE id = $1", vault_id)


async def _mixed(world: World) -> None:
    """c: a strong and a weak neighbour each way, and a chain behind each."""
    await world.docs("c", "s-out", "s-in", "w-out", "w-in", "s-out-2", "x-weak-2", "w-out-2")
    await world.link("c", "s-out", "depends_on")  # explicit, strong
    await world.link("s-in", "c", "implements")  # explicit, strong, incoming
    await world.link("c", "w-out", "references", edge_type="weak")  # explicit, weak
    await world.extract("w-in", body=f"See [c]({world.uri('c')}).")  # implicit, weak, incoming
    await world.link("s-out", "s-out-2", "depends_on")  # a strong second hop
    await world.link("s-out", "x-weak-2", "references", edge_type="weak")  # a weak second hop off a strong node
    await world.link("w-out", "w-out-2", "depends_on")  # strong, but behind a weak edge


# ── The walk over real rows ──────────────────────────────────────────────


async def test_without_edge_type_every_edge_is_walked_as_before(world):
    await _mixed(world)

    graph = await world.walk("c")

    assert world.names(graph) == {"c", "s-out", "s-in", "w-out", "w-in", "s-out-2", "x-weak-2", "w-out-2"}
    assert {e["edge_type"] for e in graph["edges"]} == {"strong", "weak"}
    assert graph["truncated"] is False


async def test_a_strong_walk_goes_through_strong_edges_only_in_both_directions(world):
    await _mixed(world)

    graph = await world.walk("c", edge_type="strong")

    assert world.names(graph) == {"c", "s-out", "s-in", "s-out-2"}
    assert {e["edge_type"] for e in graph["edges"]} == {"strong"}
    assert {(e["source"], e["target"]) for e in graph["edges"]} == {
        (world.uri("c"), world.uri("s-out")),  # outgoing
        (world.uri("s-in"), world.uri("c")),  # incoming
        (world.uri("s-out"), world.uri("s-out-2")),  # second hop, through the strong node
    }
    # `w-out-2` is reachable by a strong edge, but only past a weak one: not visited.
    assert "w-out-2" not in world.names(graph)
    assert graph["truncated"] is False


async def test_a_weak_walk_is_the_mirror_image(world):
    await _mixed(world)

    graph = await world.walk("c", edge_type="weak")

    assert world.names(graph) == {"c", "w-out", "w-in"}
    assert {e["edge_type"] for e in graph["edges"]} == {"weak"}
    assert {e["kind"] for e in graph["edges"]} == {"explicit", "implicit"}  # explicit-weak and implicit


async def test_a_strong_walk_respects_hops(world):
    await _mixed(world)

    one = await world.walk("c", hops=1, edge_type="strong")
    two = await world.walk("c", hops=2, edge_type="strong")

    assert world.names(one) == {"c", "s-out", "s-in"}
    assert world.names(two) == {"c", "s-out", "s-in", "s-out-2"}
    assert {n["depth"] for n in one["nodes"]} == {0, 1}
    assert one["truncated"] is False  # the radius is not a cut


async def test_a_node_with_no_edge_of_that_strength_is_returned_alone(world):
    await world.docs("lonely", "other")
    await world.link("lonely", "other", edge_type="weak")

    graph = await world.walk("lonely", edge_type="strong")

    assert world.names(graph) == {"lonely"}
    assert graph["edges"] == [] and graph["truncated"] is False


# ── The cap is spent on the neighbours asked for ─────────────────────────


async def _hub(world: World, strong: int, weak: int) -> None:
    await world.docs("hub", *(f"strong-{i}" for i in range(strong)), *(f"weak-{i}" for i in range(weak)))
    for i in range(strong):
        await world.link("hub", f"strong-{i}")
    for i in range(weak):
        await world.link("hub", f"weak-{i}", edge_type="weak")


async def test_thirty_weak_neighbours_do_not_crowd_ten_strong_ones_out(world):
    await _hub(world, strong=10, weak=30)

    strong = await world.walk("hub", hops=1, limit=11, edge_type="strong")
    everything = await world.walk("hub", hops=1, limit=11)

    assert len(strong["nodes"]) == 11 and strong["truncated"] is False
    assert {n for n in world.names(strong) if n != "hub"} == {f"strong-{i}" for i in range(10)}
    assert len(strong["edges"]) == 10
    # 40 neighbours for 10 slots: which ten is the database's row order, so the
    # unfiltered walk is only held to being cut, never to a particular ten.
    assert len(everything["nodes"]) == 11 and everything["truncated"] is True


@pytest.mark.parametrize(
    ("limit", "kept", "truncated"),
    [(50, 11, False), (11, 11, False), (10, 10, True), (3, 3, True), (1, 1, True)],
)
async def test_truncated_reports_a_cut_on_real_rows(world, limit, kept, truncated):
    await _hub(world, strong=10, weak=0)

    graph = await world.walk("hub", hops=1, limit=limit, edge_type="strong")

    assert len(graph["nodes"]) == kept
    assert graph["truncated"] is truncated
    assert all(e["source"] in {n["uri"] for n in graph["nodes"]} for e in graph["edges"])  # no stub endpoints


async def test_a_cut_in_a_later_wave_is_reported(world):
    await world.docs("c", "b", "d1", "d2")
    await world.link("c", "b")
    await world.link("b", "d1")
    await world.link("b", "d2")

    cut = await world.walk("c", hops=2, limit=3, edge_type="strong")
    fits = await world.walk("c", hops=2, limit=4, edge_type="strong")

    assert len(cut["nodes"]) == 3 and cut["truncated"] is True
    assert len(fits["nodes"]) == 4 and fits["truncated"] is False


async def test_the_default_walk_reports_truncation_too(world):
    await _hub(world, strong=5, weak=5)

    cut = await world.walk("hub", hops=1, limit=4)
    full = await world.walk("hub", hops=1, limit=11)

    assert cut["truncated"] is True and len(cut["nodes"]) == 4
    assert full["truncated"] is False and len(full["nodes"]) == 11


# ── The SQL fragment is the twin of resolve_edge_type ────────────────────

# (kind, edges.metadata as written, what `metadata->>'edge_type'` extracts)
SHAPES: list[tuple[str, str | None, str | None]] = [
    ("explicit", None, None),  # a NULL metadata column
    ("explicit", "{}", None),
    ("explicit", "[]", None),
    ("explicit", '"weak"', None),
    ("explicit", "null", None),
    ("explicit", '{"edge_type": null}', None),
    ("explicit", '{"note": "x"}', None),
    ("explicit", '{"edge_type": "strong"}', "strong"),
    ("explicit", '{"edge_type": "weak"}', "weak"),
    ("explicit", '{"edge_type": "medium"}', "medium"),
    ("explicit", '{"edge_type": "Weak"}', "Weak"),
    ("explicit", '{"edge_type": ""}', ""),
    ("implicit", None, None),
    ("implicit", "{}", None),
    ("implicit", '{"edge_type": "strong"}', "strong"),  # a stray key never promotes a derived edge
    ("implicit", '{"edge_type": "weak"}', "weak"),
]


async def test_the_predicates_select_what_resolve_edge_type_serves_for_every_stored_shape(world):
    names = [f"{kind}-{i}" for i, (kind, _, _) in enumerate(SHAPES)]
    await world.docs("c", *[f"{n}-out" for n in names], *[f"{n}-in" for n in names])
    for name, (kind, metadata, _stored) in zip(names, SHAPES, strict=True):
        await world.seed_edge("c", f"{name}-out", kind=kind, metadata=metadata)  # outgoing
        await world.seed_edge(f"{name}-in", "c", kind=kind, metadata=metadata)  # incoming

    expected = {"strong": {"c"}, "weak": {"c"}}
    for name, (kind, _metadata, stored) in zip(names, SHAPES, strict=True):
        expected[resolve_edge_type(kind, stored)].update({f"{name}-out", f"{name}-in"})
    assert expected["strong"] != {"c"} and expected["weak"] != {"c"}, "the matrix must exercise both strengths"

    unfiltered = await world.walk("c", hops=1, limit=200)
    strong = await world.walk("c", hops=1, limit=200, edge_type="strong")
    weak = await world.walk("c", hops=1, limit=200, edge_type="weak")

    assert world.names(unfiltered) == {"c"} | expected["strong"] | expected["weak"]
    assert world.names(strong) == expected["strong"]
    assert world.names(weak) == expected["weak"]
    # The walk and the label agree row by row: whatever the walk returned, each
    # edge is served with the strength that was asked for.
    assert {e["edge_type"] for e in strong["edges"]} == {"strong"}
    assert {e["edge_type"] for e in weak["edges"]} == {"weak"}
    assert {e["edge_type"] for e in unfiltered["edges"]} == {"strong", "weak"}
    assert len(strong["edges"]) + len(weak["edges"]) == len(unfiltered["edges"]) == 2 * len(SHAPES)


async def test_a_relink_that_changes_the_strength_moves_the_neighbour_between_walks(world):
    await world.docs("c", "d")
    await world.link("c", "d")
    assert world.names(await world.walk("c", edge_type="strong")) == {"c", "d"}
    assert world.names(await world.walk("c", edge_type="weak")) == {"c"}

    await world.link("c", "d", edge_type="weak")

    assert world.names(await world.walk("c", edge_type="strong")) == {"c"}
    assert world.names(await world.walk("c", edge_type="weak")) == {"c", "d"}


async def test_a_strong_walk_costs_the_same_round_trips_as_the_unfiltered_one(world, monkeypatch):
    await _mixed(world)
    statements: list[str] = []

    class _Recording:
        def __init__(self, conn) -> None:
            self._conn = conn

        def __getattr__(self, name):
            attr = getattr(self._conn, name)
            if name != "fetch":
                return attr

            async def fetch(query, *args, **kwargs):
                statements.append(query)
                return await attr(query, *args, **kwargs)

            return fetch

    class _Acquire:
        def __init__(self, inner) -> None:
            self._inner = inner

        async def __aenter__(self):
            return _Recording(await self._inner.__aenter__())

        async def __aexit__(self, *exc):
            return await self._inner.__aexit__(*exc)

    class _Pool:
        def acquire(self):
            return _Acquire(world.pool.acquire())

    async def _get_pool():
        return _Pool()

    monkeypatch.setattr(kg_service, "get_pool", _get_pool)

    await world.walk("c")
    unfiltered = len(statements)
    statements.clear()
    await world.walk("c", edge_type="strong")

    assert len(statements) == unfiltered


# ── The overview is not strength-aware, and says so ──────────────────────


async def test_the_overview_still_returns_every_edge_and_refuses_edge_type_through_get_graph(world):
    await _mixed(world)

    overview = await kg_service.get_overview(world.vault, vault_id=world.vault_id, include_orphans=False)
    whole_vault = await kg_service.get_graph(world.vault, None, vault_id=world.vault_id)
    refused = await kg_service.get_graph(world.vault, None, vault_id=world.vault_id, edge_type="strong")

    assert {e["edge_type"] for e in overview["edges"]} == {"strong", "weak"}
    assert len(overview["edges"]) == 7 and overview["truncated"] is False
    assert {e["edge_type"] for e in whole_vault["edges"]} == {"strong", "weak"}
    assert refused["code"] == "invalid_argument" and "nodes" not in refused


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


async def test_rest_walks_only_the_requested_strength(world, rest):
    await _mixed(world)
    params = {"uri": world.uri("c"), "hops": 2, "limit": 50}

    default = (await rest.get("/api/v1/graph", params=params)).json()
    strong = (await rest.get("/api/v1/graph", params={**params, "edge_type": "strong"})).json()
    weak = (await rest.get("/api/v1/graph", params={**params, "edge_type": "weak"})).json()

    assert default["kind"] == strong["kind"] == weak["kind"] == "graph_neighbors"
    assert world.names(strong) == {"c", "s-out", "s-in", "s-out-2"}
    assert world.names(weak) == {"c", "w-out", "w-in"}
    assert len(world.names(default)) == 8
    assert default["truncated"] is False and strong["truncated"] is False


async def test_rest_reports_truncation_and_validates_the_parameter(world, rest):
    await _hub(world, strong=10, weak=30)
    params = {"uri": world.uri("hub"), "hops": 1}

    cut = (await rest.get("/api/v1/graph", params={**params, "limit": 5, "edge_type": "strong"})).json()
    fits = (await rest.get("/api/v1/graph", params={**params, "limit": 11, "edge_type": "strong"})).json()
    invalid = await rest.get("/api/v1/graph", params={**params, "edge_type": "medium"})
    overview = await rest.get("/api/v1/graph", params={"vault": world.vault, "edge_type": "strong"})

    assert len(cut["nodes"]) == 5 and cut["truncated"] is True
    assert len(fits["nodes"]) == 11 and fits["truncated"] is False
    assert invalid.status_code == 422
    assert overview.status_code == 400 and "`uri`" in overview.json()["detail"]


@pytest_asyncio.fixture
async def mcp(world, monkeypatch):
    async def _access(*_args, **_kwargs):
        return {"vault_id": world.vault_id, "role": "reader"}

    monkeypatch.setattr(server, "check_vault_access", _access)
    user = server._MCPUser(user_id=str(uuid.uuid4()), username="tester")

    async def call(tool: str, **arguments: Any) -> dict:
        return await server._dispatch(tool, arguments, user)

    return call


async def test_mcp_akb_graph_walks_only_the_requested_strength(world, mcp):
    await _mixed(world)
    uri = world.uri("c")

    default = await mcp("akb_graph", uri=uri)
    strong = await mcp("akb_graph", uri=uri, edge_type="strong")
    weak = await mcp("akb_graph", uri=uri, edge_type="weak")
    explicit_null = await mcp("akb_graph", uri=uri, edge_type=None)

    assert len(world.names(default)) == 8 and world.names(explicit_null) == world.names(default)
    assert world.names(strong) == {"c", "s-out", "s-in", "s-out-2"}
    assert world.names(weak) == {"c", "w-out", "w-in"}
    assert {e["edge_type"] for e in strong["edges"]} == {"strong"}
    assert strong["truncated"] is False


async def test_mcp_akb_graph_refuses_what_the_walk_cannot_honour(world, mcp):
    await _mixed(world)

    invalid = await mcp("akb_graph", uri=world.uri("c"), edge_type="medium")
    overview = await mcp("akb_graph", vault=world.vault, edge_type="strong")
    plain_overview = await mcp("akb_graph", vault=world.vault)

    assert invalid["code"] == "invalid_argument"
    assert overview["code"] == "invalid_argument" and overview["hint"]
    assert "nodes" not in invalid and "nodes" not in overview
    assert {e["edge_type"] for e in plain_overview["edges"]} == {"strong", "weak"}  # untouched
