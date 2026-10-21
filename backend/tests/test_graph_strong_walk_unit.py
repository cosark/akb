"""Strength-aware neighbourhood walk (``edge_type`` on ``/graph?uri=`` and ``akb_graph``) — DB-free.

``edge_type`` ("strong" | "weak"; omitted = every edge) restricts the BFS itself,
in both directions, so the ``limit`` node cap is spent on the neighbours the
caller asked for instead of being spent on edges that are then filtered away.
The vault overview is not strength-aware and a request that pairs it with
``edge_type`` is refused.

This file pins what needs no database: the SQL fragment that is the twin of
``resolve_edge_type``, that the walk applies it to the outgoing and the incoming
fetch alike, how ``hops`` / ``limit`` / ``truncated`` behave, and the REST and
MCP parameter handling. That the fragment *selects the right rows* is a fact
about PostgreSQL and runs there, in ``test_graph_strong_walk_postgres.py``.
"""

from __future__ import annotations

import tempfile
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.api.routes import knowledge
from app.config import settings

# Importing the MCP server builds the revision backend, which creates its Git
# storage directory; point it somewhere writable before that import.
settings.git_storage_path = tempfile.mkdtemp(prefix="akb-strong-walk-unit-")

from app.services import kg_service
from app.services.kg_service import EDGE_TYPES, edge_strength_sql, resolve_edge_type
from mcp_server import server
from mcp_server.tools import TOOLS

VAULT = "strongwalk"
VAULT_ID = uuid.uuid4()


def uri(name: str) -> str:
    return f"akb://{VAULT}/coll/n/doc/{name}.md"


STRONG_SQL = edge_strength_sql("strong")
WEAK_SQL = edge_strength_sql("weak")


# ── The SQL twin of resolve_edge_type ────────────────────────────────────


def test_the_strength_predicate_is_the_documented_rule():
    assert edge_strength_sql(None) == ""
    assert edge_strength_sql("strong") == (
        "(kind = 'explicit' AND metadata->>'edge_type' IS DISTINCT FROM 'weak')"
    )
    assert edge_strength_sql("weak") == "(kind <> 'explicit' OR metadata->>'edge_type' = 'weak')"
    assert edge_strength_sql("strong", alias="e") == (
        "(e.kind = 'explicit' AND e.metadata->>'edge_type' IS DISTINCT FROM 'weak')"
    )
    assert edge_strength_sql("weak", alias="e") == "(e.kind <> 'explicit' OR e.metadata->>'edge_type' = 'weak')"


@pytest.mark.parametrize("bad", ["medium", "", "Strong", "strong; DROP TABLE edges", 1, ["weak"]])
def test_a_value_outside_the_vocabulary_never_reaches_sql(bad):
    with pytest.raises(ValueError, match="edge_type"):
        edge_strength_sql(bad)  # type: ignore[arg-type]


def test_the_predicates_partition_the_edges_the_way_resolve_edge_type_does():
    """The documented rule, written out, is a partition that agrees with `resolve_edge_type`.

    `strong` / `weak` below restate what `edge_strength_sql` says in words (the
    exact-text test above pins the SQL to it). That they split every
    (kind, stored) shape into two buckets, and agree with `resolve_edge_type`
    on each, is checked without a database; that PostgreSQL evaluates the
    fragments the same way is checked in `test_graph_strong_walk_postgres.py`.
    """
    def strong(kind, stored):
        return kind == "explicit" and stored != "weak"

    def weak(kind, stored):
        return kind != "explicit" or stored == "weak"

    for kind in ("implicit", "explicit"):
        for stored in (None, "strong", "weak", "medium", "Weak", ""):
            served = resolve_edge_type(kind, stored)
            assert strong(kind, stored) == (served == "strong"), (kind, stored)
            assert weak(kind, stored) == (served == "weak"), (kind, stored)
            assert strong(kind, stored) != weak(kind, stored), (kind, stored)  # a partition


# ── The walk, against an in-memory edge table ────────────────────────────


class _Acquire:
    def __init__(self, conn) -> None:
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, *_args):
        return None


class _Pool:
    def __init__(self, conn) -> None:
        self.conn = conn

    def acquire(self):
        return _Acquire(self.conn)


class _Edges:
    """An `edges` table the BFS can fetch from.

    The strength predicate is applied the way PostgreSQL would apply it — chosen
    by which exact fragment the query carries — so a walk that forgot it on one
    direction, or built it for the wrong strength, is caught here. The fragment's
    own semantics are not re-implemented: the row is kept or dropped by
    `resolve_edge_type`, the rule the fragment is the twin of.
    """

    def __init__(self, *edges: tuple[str, str, str, str | None]) -> None:
        # (source, target, kind, stored edge_type)
        self.edges = list(edges)
        self.queries: list[str] = []

    def _keep(self, query: str, kind: str, stored: str | None) -> bool:
        served = resolve_edge_type(kind, stored)
        if STRONG_SQL in query:
            return served == "strong"
        if WEAK_SQL in query:
            return served == "weak"
        return True

    async def fetch(self, query: str, *args):
        if "FROM edges" not in query:
            return []  # the label lookups: nothing resolves, nodes keep their placeholder names
        self.queries.append(query)
        seeds = set(args[0])
        outgoing = "source_uri = ANY" in query
        return [
            {
                "source_uri": s, "target_uri": t, "source_type": "doc", "target_type": "doc",
                "relation_type": "references", "kind": kind, "stored_edge_type": stored,
            }
            for s, t, kind, stored in self.edges
            if (s if outgoing else t) in seeds and self._keep(query, kind, stored)
        ]


async def _walk(edges: _Edges, start: str, *, hops: int = 2, limit: int = 50, edge_type=None):
    nodes: dict[str, dict] = {}
    edge_list: list[dict] = []
    truncated = await kg_service._bfs_collect(
        edges, VAULT_ID, VAULT, start, hops, limit, nodes, edge_list, edge_type=edge_type,
    )
    return nodes, edge_list, truncated


def _names(nodes: dict[str, dict]) -> set[str]:
    return {u.rsplit("/", 1)[-1].removesuffix(".md") for u in nodes}


def _mixed() -> _Edges:
    """c with one strong and one weak neighbour each way, and a chain behind each."""
    c = uri("c")
    return _Edges(
        (c, uri("s-out"), "explicit", None),  # strong (key absent: predates the attribute)
        (uri("s-in"), c, "explicit", "strong"),  # strong, incoming
        (c, uri("w-out"), "explicit", "weak"),  # weak, explicit
        (uri("w-in"), c, "implicit", None),  # weak, implicit, incoming
        (uri("s-out"), uri("s-out-2"), "explicit", "strong"),  # a strong second hop
        (uri("s-out"), uri("x-weak-2"), "explicit", "weak"),  # a weak second hop off a strong node
        (uri("w-out"), uri("w-out-2"), "explicit", "strong"),  # strong, but behind a weak edge
    )


@pytest.mark.asyncio
async def test_without_edge_type_the_walk_follows_every_edge_and_adds_no_predicate():
    edges = _mixed()

    nodes, edge_list, truncated = await _walk(edges, uri("c"))

    assert _names(nodes) == {"c", "s-out", "s-in", "w-out", "w-in", "s-out-2", "x-weak-2", "w-out-2"}
    assert len(edge_list) == 7
    assert truncated is False
    assert len(edges.queries) == 6  # outgoing + incoming, once per wave (hops=2 is three waves)
    assert not any("IS DISTINCT FROM" in q or "kind <> 'explicit'" in q for q in edges.queries)


@pytest.mark.asyncio
async def test_a_strong_walk_goes_through_strong_edges_only_in_both_directions():
    edges = _mixed()

    nodes, edge_list, truncated = await _walk(edges, uri("c"), edge_type="strong")

    assert _names(nodes) == {"c", "s-out", "s-in", "s-out-2"}
    assert {e["edge_type"] for e in edge_list} == {"strong"}
    assert len(edge_list) == 3
    # Never visited — not merely filtered out afterwards.
    assert {"w-out", "w-in", "x-weak-2", "w-out-2"}.isdisjoint(_names(nodes))
    assert truncated is False


@pytest.mark.asyncio
async def test_a_weak_walk_is_the_mirror_image():
    nodes, edge_list, _ = await _walk(_mixed(), uri("c"), edge_type="weak")

    assert _names(nodes) == {"c", "w-out", "w-in"}
    assert {e["edge_type"] for e in edge_list} == {"weak"}
    assert len(edge_list) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("edge_type", EDGE_TYPES)
async def test_the_predicate_is_on_the_outgoing_and_the_incoming_fetch(edge_type):
    edges = _mixed()
    fragment = edge_strength_sql(edge_type)

    await _walk(edges, uri("c"), edge_type=edge_type)

    outgoing = [q for q in edges.queries if "source_uri = ANY" in q]
    incoming = [q for q in edges.queries if "target_uri = ANY" in q]
    assert outgoing and incoming
    assert all(fragment in q for q in outgoing + incoming)
    # ... and still inside the vault scope, ANDed on rather than replacing it.
    assert all("starts_with(source_uri" in q and "starts_with(target_uri" in q for q in outgoing + incoming)


@pytest.mark.asyncio
async def test_a_strong_walk_respects_hops():
    nodes, _, truncated = await _walk(_mixed(), uri("c"), hops=1, edge_type="strong")

    assert _names(nodes) == {"c", "s-out", "s-in"}  # s-out-2 is two hops out
    assert truncated is False  # the radius is not a cut
    assert {n["depth"] for n in nodes.values()} == {0, 1}


@pytest.mark.asyncio
async def test_the_node_cap_is_spent_on_strong_neighbours_only():
    """10 strong and 30 weak neighbours: a strong walk fits in 11, an unfiltered one cannot."""
    c = uri("hub")
    edges = _Edges(
        *[(c, uri(f"strong-{i}"), "explicit", None) for i in range(10)],
        *[(c, uri(f"weak-{i}"), "explicit", "weak") for i in range(30)],
    )

    strong_nodes, strong_edges, strong_truncated = await _walk(edges, c, hops=1, limit=11, edge_type="strong")
    all_nodes, _, all_truncated = await _walk(edges, c, hops=1, limit=11)

    assert len(strong_nodes) == 11 and strong_truncated is False
    assert all(name.startswith(("strong-", "hub")) for name in _names(strong_nodes))
    assert len(strong_edges) == 10
    assert len(all_nodes) == 11 and all_truncated is True  # 40 neighbours, 10 slots


# ── Truncation is reported honestly ──────────────────────────────────────


def _star(count: int) -> _Edges:
    return _Edges(*[(uri("c"), uri(f"leaf-{i}"), "explicit", None) for i in range(count)])


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("leaves", "limit", "kept", "truncated"),
    [
        (3, 10, 4, False),  # room to spare
        (3, 4, 4, False),  # an exact fit is not a cut
        (3, 3, 3, True),  # one leaf did not fit
        (3, 1, 1, True),  # only the centre fits
        (0, 1, 1, False),  # an isolated centre has nothing to cut
        (0, 5, 1, False),
    ],
)
async def test_truncated_means_a_qualifying_node_did_not_fit(leaves, limit, kept, truncated):
    nodes, edge_list, reported = await _walk(_star(leaves), uri("c"), hops=1, limit=limit)

    assert len(nodes) == kept
    assert reported is truncated
    # An edge to a node that was cut is dropped, never served as a stub.
    assert all(e["source"] in nodes and e["target"] in nodes for e in edge_list)


@pytest.mark.asyncio
async def test_a_node_reached_from_two_parents_is_not_counted_twice():
    c = uri("c")
    diamond = _Edges(
        (c, uri("b"), "explicit", None), (c, uri("d"), "explicit", None),
        (uri("b"), uri("e"), "explicit", None), (uri("d"), uri("e"), "explicit", None),
    )

    nodes, _, truncated = await _walk(diamond, c, hops=2, limit=4)

    assert _names(nodes) == {"c", "b", "d", "e"}
    assert truncated is False  # e was queued twice and still fits exactly


@pytest.mark.asyncio
async def test_the_cap_reached_between_waves_is_reported():
    c = uri("c")
    chain = _Edges((c, uri("b"), "explicit", None), (uri("b"), uri("d"), "explicit", None))

    nodes, _, truncated = await _walk(chain, c, hops=2, limit=2)

    assert _names(nodes) == {"c", "b"}
    assert truncated is True  # d, a second-hop neighbour, was waiting when the cap closed


@pytest.mark.asyncio
async def test_nodes_beyond_the_radius_are_not_a_truncation():
    c = uri("c")
    chain = _Edges((c, uri("b"), "explicit", None), (uri("b"), uri("d"), "explicit", None))

    nodes, _, truncated = await _walk(chain, c, hops=1, limit=50)

    assert _names(nodes) == {"c", "b"}
    assert truncated is False


# ── get_graph: parameter handling ────────────────────────────────────────


def _forbid_pool(monkeypatch) -> None:
    async def _pool():
        raise AssertionError("a refused request must not open PostgreSQL")

    monkeypatch.setattr(kg_service, "get_pool", _pool)


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["medium", "", "Strong", 0, ["weak"]])
async def test_an_invalid_edge_type_is_refused_before_the_database(monkeypatch, bad):
    _forbid_pool(monkeypatch)

    result = await kg_service.get_graph(VAULT, uri("c"), vault_id=VAULT_ID, edge_type=bad)

    assert result["code"] == "invalid_argument"
    assert "edge_type must be one of ['strong', 'weak']" in result["error"]
    assert "nodes" not in result


@pytest.mark.asyncio
@pytest.mark.parametrize("edge_type", EDGE_TYPES)
async def test_edge_type_without_a_uri_is_refused_not_ignored(monkeypatch, edge_type):
    """The overview is not strength-aware; answering with every edge would mislead."""
    _forbid_pool(monkeypatch)

    result = await kg_service.get_graph(VAULT, None, vault_id=VAULT_ID, edge_type=edge_type)

    assert result["code"] == "invalid_argument"
    assert "`uri`" in result["error"]
    assert "hint" in result


@pytest.mark.asyncio
async def test_without_edge_type_the_overview_is_untouched(monkeypatch):
    seen: dict = {}

    async def _overview(vault, **kwargs):
        seen.update(kwargs, vault=vault)
        return {"nodes": [], "edges": [], "truncated": False}

    monkeypatch.setattr(kg_service, "get_overview", _overview)

    result = await kg_service.get_graph(VAULT, None, limit=77, vault_id=VAULT_ID)

    assert result == {"nodes": [], "edges": [], "truncated": False}
    assert seen == {"vault": VAULT, "vault_id": VAULT_ID, "top_k": 77}


@pytest.mark.asyncio
async def test_a_uri_outside_the_vault_returns_an_empty_untruncated_graph(monkeypatch):
    _forbid_pool(monkeypatch)

    result = await kg_service.get_graph(
        VAULT, "akb://elsewhere/doc/x.md", vault_id=VAULT_ID, edge_type="strong",
    )

    assert result == {"nodes": [], "edges": [], "truncated": False}


@pytest.mark.asyncio
@pytest.mark.parametrize("edge_type", [None, "strong", "weak"])
async def test_the_neighbourhood_forwards_edge_type_and_reports_truncation(monkeypatch, edge_type):
    seen: dict = {}

    async def _bfs(conn, vault_id, vault, start, hops, limit, nodes, edges, *, edge_type=None):
        seen.update(hops=hops, limit=limit, edge_type=edge_type)
        nodes[start] = {"uri": start, "resource_type": "doc", "name": "x", "depth": 0}
        return True

    monkeypatch.setattr(kg_service, "_bfs_collect", _bfs)

    async def _pool():
        return _Pool(object())

    monkeypatch.setattr(kg_service, "get_pool", _pool)

    result = await kg_service.get_graph(
        VAULT, uri("c"), hops=3, limit=9, vault_id=VAULT_ID, edge_type=edge_type,
    )

    assert seen == {"hops": 3, "limit": 9, "edge_type": edge_type}
    assert result["truncated"] is True
    assert [n["uri"] for n in result["nodes"]] == [uri("c")]


# ── REST ─────────────────────────────────────────────────────────────────


class _FakeUser:
    user_id = "u-test"
    username = "tester"


@pytest.fixture
def client(monkeypatch):
    async def _reader(*_args, **_kwargs):
        return {"vault_id": VAULT_ID, "role": "reader", "status": "active"}

    monkeypatch.setattr(knowledge, "check_vault_access", _reader)
    app = FastAPI()
    app.include_router(knowledge.router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    return TestClient(app)


def test_rest_forwards_edge_type_to_the_service_and_serves_truncated(client, monkeypatch):
    seen: dict = {}

    async def _graph(vault, resource_uri=None, **kwargs):
        seen.update(kwargs, vault=vault, uri=resource_uri)
        return {"nodes": [], "edges": [], "truncated": True}

    monkeypatch.setattr(knowledge, "get_graph", _graph)

    body = client.get("/api/v1/graph", params={"uri": uri("c"), "edge_type": "strong"}).json()
    default = client.get("/api/v1/graph", params={"uri": uri("c")}).json()

    assert seen["edge_type"] is None  # the second call: omitted means every edge
    assert body["kind"] == default["kind"] == "graph_neighbors"
    assert body["truncated"] is True


def test_rest_passes_the_strength_through(client, monkeypatch):
    seen: list = []

    async def _graph(vault, resource_uri=None, **kwargs):
        seen.append(kwargs["edge_type"])
        return {"nodes": [], "edges": [], "truncated": False}

    monkeypatch.setattr(knowledge, "get_graph", _graph)
    for value in ("strong", "weak"):
        assert client.get("/api/v1/graph", params={"uri": uri("c"), "edge_type": value}).status_code == 200

    assert seen == ["strong", "weak"]


@pytest.mark.parametrize("bad", ["medium", "", "Strong", "strong,weak"])
def test_rest_rejects_an_invalid_edge_type(client, monkeypatch, bad):
    async def _graph(*_args, **_kwargs):
        raise AssertionError("an invalid edge_type must be refused before the service runs")

    monkeypatch.setattr(knowledge, "get_graph", _graph)

    response = client.get("/api/v1/graph", params={"uri": uri("c"), "edge_type": bad})

    assert response.status_code == 422


def test_rest_refuses_edge_type_on_the_vault_overview(client):
    response = client.get("/api/v1/graph", params={"vault": VAULT, "edge_type": "strong"})

    assert response.status_code == 400
    assert "`uri`" in response.json()["detail"]


def test_rest_documents_edge_type_as_an_enum_on_the_neighbourhood_route():
    from app.main import app

    operation = app.openapi()["paths"]["/api/v1/graph"]["get"]
    param = next(p for p in operation["parameters"] if p["name"] == "edge_type")

    assert param["required"] is False
    options = param["schema"].get("anyOf") or [param["schema"]]
    assert next(o["enum"] for o in options if "enum" in o) == list(EDGE_TYPES)
    assert "neighbourhood" in param["description"].lower()


# ── MCP ──────────────────────────────────────────────────────────────────


def _mcp_user():
    return server._MCPUser(user_id=str(uuid.uuid4()), username="tester")


def test_akb_graph_advertises_edge_type_from_the_shared_vocabulary():
    graph = next(tool for tool in TOOLS if tool.name == "akb_graph")
    edge_type = graph.input_schema["properties"]["edge_type"]

    assert edge_type["enum"] == list(EDGE_TYPES)
    assert "edge_type" not in graph.input_schema.get("required", [])
    assert "uri" in edge_type["description"]
    assert "edge_type" in server._TOOL_ARG_NAMES["akb_graph"]
    assert "edge_type" not in server._TOOL_ARG_NAMES["akb_relations"]


@pytest.fixture
def reader(monkeypatch):
    async def _access(*_args, **_kwargs):
        return {"vault_id": VAULT_ID, "role": "reader"}

    monkeypatch.setattr(server, "check_vault_access", _access)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("extra", "expected"),
    [({}, None), ({"edge_type": None}, None), ({"edge_type": "strong"}, "strong"), ({"edge_type": "weak"}, "weak")],
)
async def test_akb_graph_forwards_edge_type(monkeypatch, reader, extra, expected):
    seen: dict = {}

    async def _graph(vault, **kwargs):
        seen.update(kwargs)
        return {"nodes": [], "edges": [], "truncated": False}

    monkeypatch.setattr(server, "get_graph", _graph)

    await server._dispatch("akb_graph", {"uri": uri("c"), "hops": 1, **extra}, _mcp_user())

    assert seen["edge_type"] == expected
    assert (seen["hops"], seen["limit"]) == (1, 50)


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["medium", "", "Weak", 0])
async def test_akb_graph_refuses_an_invalid_edge_type(monkeypatch, reader, bad):
    _forbid_pool(monkeypatch)

    result = await server._dispatch("akb_graph", {"uri": uri("c"), "edge_type": bad}, _mcp_user())

    assert result["code"] == "invalid_argument"


@pytest.mark.asyncio
async def test_akb_graph_refuses_edge_type_with_a_vault_and_no_uri(monkeypatch, reader):
    _forbid_pool(monkeypatch)

    result = await server._dispatch("akb_graph", {"vault": VAULT, "edge_type": "strong"}, _mcp_user())

    assert result["code"] == "invalid_argument"
    assert "uri" in result["error"] and result["hint"]
