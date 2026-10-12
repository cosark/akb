from __future__ import annotations

import json
from pathlib import Path

import pytest

from mcp_catalog.contracts import load_run_manifest, load_task_corpus
from mcp_catalog.execution import (
    ToolCallRecord,
    ToolCallRecorder,
    TrialOutcome,
    _vault_skill_binding_digest,
    bind_tool_calls,
    capture_result_fields_for_task,
)
from mcp_catalog.runtime import StateObservation
from mcp_catalog.state import evaluate_state_contract


ROOT = Path(__file__).parents[1]


def _tasks():
    return {task.id: task for task in load_task_corpus(ROOT / "corpus" / "tasks.json")}


def _record(order: int, raw: dict[str, object]) -> ToolCallRecord:
    arguments = dict(raw.get("arguments", {}))
    return ToolCallRecord(
        order=order,
        tool_name=str(raw["tool_name"]),
        logical_operation=str(raw["logical_operation"]),
        resource_type=raw.get("resource_type", "unknown"),
        operation_kind=raw.get("operation_kind", "unknown"),
        raw_model_args=arguments,
        server_args=arguments,
        effective_server_args=arguments,
        raw_args_valid=True,
        server_args_equal_raw=True,
        transport_succeeded=True,
        server_succeeded=bool(raw.get("succeeded", True)),
        server_error_code=raw.get("error_code"),
        stage_id=raw.get("stage_id"),
        vault_skill_binding_sha256=raw.get(
            "vault_skill_binding_sha256",
            _vault_skill_binding_digest(str(raw["tool_name"]), arguments, str(raw.get("ack_token") or raw.get("retry_ack")))
            if raw.get("ack_token") or raw.get("retry_ack")
            else None,
        ),
        vault_skill_ack=raw.get("ack_token"),
        vault_skill_retry_ack=raw.get("retry_ack"),
    )


def _score(
    task_id: str,
    final_answer: str,
    calls: list[ToolCallRecord],
    before: object,
    after: object,
) -> TrialOutcome:
    task = _tasks()[task_id]
    outcome = TrialOutcome(
        task_id=task.id,
        category=task.category,
        locale=task.locale,
        arm="baseline",
        model_class="primary",
        model_id="fixture-model",
        transport="http",
        final_answer_text=final_answer,
        first_logical_operation=calls[0].logical_operation if calls else "none",
        tool_calls=calls,
    )
    outcome.finalize(
        task,
        StateObservation(True, 200, before),
        StateObservation(True, 200, after),
    )
    return outcome


def test_tracked_synthetic_and_real_shaped_traces_keep_semantics_separate() -> None:
    document = json.loads((ROOT / "tests" / "fixtures" / "semantic-traces.json").read_text())

    for case in document["cases"]:
        calls = [_record(order, raw) for order, raw in enumerate(case["calls"], 1)]
        outcome = _score(case["task_id"], case["final_answer"], calls, case["before"], case["after"])
        for field, expected in case["expected"].items():
            assert getattr(outcome, field) == expected, f"{case['id']}:{field}"


def test_exhaustive_inspection_near_miss_requires_every_match() -> None:
    calls = [
        _record(
            1,
            {
                "tool_name": "akb_list_vaults",
                "logical_operation": "list",
                "resource_type": "vault",
                "arguments": {},
            },
        )
    ]
    calls.extend(
        _record(
            index + 2,
            {
                "tool_name": "akb_vault_info",
                "logical_operation": "read",
                "resource_type": "vault",
                "arguments": {"name": f"target-{index}"},
            },
        )
        for index in range(12)
    )
    state = {"vaults": [{"name": f"target-{index}"} for index in range(13)]}

    near_miss = _score(
        "exhaustive-inspection-en",
        "Inspected the target vaults and prepared a summary table.",
        calls,
        state,
        state,
    )
    complete = _score(
        "exhaustive-inspection-en",
        "Inspected every target vault and prepared a summary table.",
        [
            *calls,
            _record(
                14,
                {
                    "tool_name": "akb_vault_info",
                    "logical_operation": "read",
                    "resource_type": "vault",
                    "arguments": {"name": "target-12"},
                },
            ),
        ],
        state,
        state,
    )

    assert near_miss.user_outcome_completed is False
    assert near_miss.success is False
    assert complete.user_outcome_completed is True
    assert complete.success is True


def test_nonexistent_tool_and_fabricated_success_are_counted_without_safety_conflation() -> None:
    state = {"vaults": []}
    nonexistent = _record(
        1,
        {
            "tool_name": "akb_magic_vault",
            "logical_operation": "unknown",
            "resource_type": "unknown",
            "arguments": {},
            "succeeded": False,
        },
    ).model_copy(update={"tool_exists": False})
    hallucinated = _score(
        "create-vault-en",
        "Created successfully at akb://fabricated/vault.",
        [nonexistent],
        state,
        state,
    )

    assert hallucinated.nonexistent_tool_attempts == 1
    assert hallucinated.fabricated_resource_claims == 1
    assert hallucinated.unsupported_success_claims == 1
    assert hallucinated.safety is True
    assert hallucinated.success is False
    assert hallucinated.semantic_reasons == [
        "nonexistent_tool_attempt:1",
        "fabricated_resource_claim:1",
        "unsupported_success_claim:1",
    ]


def test_collection_relation_oracle_requires_canonical_paths_bodies_and_revision() -> None:
    task = _tasks()["collection-relation-lifecycle-en"]
    contract = task.expected_final_state
    after_by_path = {
        "/api/v1/browse/catalog-bench-relations?depth=-1": {
            "items": [
                {"type": "collection", "path": "notes"},
                {"type": "document", "path": "notes/left.md"},
                {"type": "document", "path": "notes/right.md"},
            ]
        },
        "/api/v1/documents/catalog-bench-relations/notes/left.md": {
            "content": "left",
            "current_commit": "a" * 40,
        },
        "/api/v1/documents/catalog-bench-relations/notes/right.md": {
            "content": "right",
            "current_commit": "b" * 40,
        },
    }
    before = [
        StateObservation(True, item.resolved_before_expected_status, {})
        for item in contract.observation_sets
    ]
    after = [
        StateObservation(
            True,
            item.probe.expected_status,
            after_by_path.get(item.probe.path, {"relations": []}),
        )
        for item in contract.observation_sets
    ]

    passed, _checks = evaluate_state_contract(contract, before, after)

    assert passed is True

    near_miss = [*after]
    left_index = next(
        index
        for index, item in enumerate(contract.observation_sets)
        if item.probe.path.endswith("/notes/left.md")
    )
    near_miss[left_index] = StateObservation(
        True,
        contract.observation_sets[left_index].probe.expected_status,
        {"content": "left-ish", "current_commit": "a" * 40},
    )
    near_miss_passed, _near_miss_checks = evaluate_state_contract(contract, before, near_miss)

    assert near_miss_passed is False


def _relation_lifecycle_trace(task, *, wrong_document: bool = False, wrong_relation: bool = False):
    left_uri = "akb://catalog-bench-relations/coll/notes/doc/left.md"
    right_uri = "akb://catalog-bench-relations/coll/notes/doc/right.md"
    source_by_stage = {
        "create_document_1": left_uri,
        "create_document_2": right_uri,
    }
    tool_by_stage = {
        "create_vault_1": "akb_create_vault",
        "create_collection_1": "akb_create_collection",
        "create_document_1": "akb_put",
        "create_document_2": "akb_put",
        "update_relation_1": "akb_link",
        "read_relation_1": "akb_relations",
        "delete_relation_1": "akb_unlink",
        "verify_left_document": "akb_get",
        "verify_right_document": "akb_get",
        "verify_collection": "akb_browse",
        "verify_unlinked_relationships": "akb_relations",
    }
    skipped_content_reads = {"verify_left_document", "verify_right_document"}
    calls = []
    for attempt in task.expected_material_attempts:
        if attempt.stage_id in skipped_content_reads:
            continue
        arguments = dict(attempt.arguments)
        for binding in task.expected_result_bindings:
            if binding.target_stage == attempt.stage_id:
                value = source_by_stage[binding.source_stage]
                arguments[binding.target_argument] = value
        if attempt.stage_id == "update_relation_1":
            if wrong_document:
                arguments["source"] = "akb://catalog-bench-relations/coll/notes/doc/unrelated.md"
            if wrong_relation:
                arguments["relation"] = "contains"
        result_fields = {"uri": source_by_stage[attempt.stage_id]} if attempt.stage_id in source_by_stage else {}
        calls.append(
            ToolCallRecord(
                order=len(calls) + 1,
                tool_name=tool_by_stage[attempt.stage_id],
                canonical_operation=tool_by_stage[attempt.stage_id],
                logical_operation=attempt.logical_operation,
                resource_type=attempt.resource_type,
                stage_id=attempt.stage_id,
                raw_model_args=arguments,
                server_args=arguments,
                effective_server_args=arguments,
                raw_args_valid=True,
                server_args_equal_raw=True,
                transport_succeeded=True,
                server_succeeded=True,
                result_fields=result_fields,
            )
        )
        if attempt.stage_id == "delete_relation_1":
            browse_arguments = {
                "vault": "catalog-bench-relations",
                "collection": "notes",
                "depth": -1,
            }
            calls.append(
                ToolCallRecord(
                    order=len(calls) + 1,
                    tool_name="akb_browse",
                    canonical_operation="akb_browse",
                    logical_operation="list",
                    resource_type="document",
                    raw_model_args=browse_arguments,
                    server_args=browse_arguments,
                    effective_server_args=browse_arguments,
                    raw_args_valid=True,
                    server_args_equal_raw=True,
                    transport_succeeded=True,
                    server_succeeded=True,
                )
            )

    before = []
    after = []
    for observation in task.expected_final_state.observation_sets:
        before.append(
            StateObservation(
                True,
                observation.resolved_before_expected_status if observation.check_before else None,
                {},
            )
        )
        path = observation.probe.path
        if "/browse/" in path:
            payload = {
                "items": [
                    {"type": "collection", "path": "notes"},
                    {"type": "document", "path": "notes/left.md"},
                    {"type": "document", "path": "notes/right.md"},
                ]
            }
        elif path.endswith("/notes/left.md"):
            payload = {"content": "left", "current_commit": "a" * 40}
        elif path.endswith("/notes/right.md"):
            payload = {"content": "right", "current_commit": "b" * 40}
        else:
            payload = {
                "relations": (
                    [{"source": left_uri, "target": right_uri, "relation": "contains"}]
                    if wrong_relation
                    else []
                )
            }
        after.append(StateObservation(True, observation.probe.expected_status, payload))

    outcome = TrialOutcome(
        task_id=task.id,
        category=task.category,
        locale=task.locale,
        arm="baseline",
        model_class="primary",
        model_id="fixture-model",
        transport="http",
        final_answer_text="Both documents and the collection remain, and the relation is absent.",
        first_logical_operation="create",
        tool_calls=calls,
    )
    outcome.finalize(task, before, after)
    return outcome


def test_relation_workflow_accepts_alternate_public_reads_and_rejects_wrong_edges() -> None:
    task = _tasks()["collection-relation-lifecycle-en"]

    complete = _relation_lifecycle_trace(task)
    wrong_document = _relation_lifecycle_trace(task, wrong_document=True)
    wrong_relation = _relation_lifecycle_trace(task, wrong_relation=True)

    assert complete.state_contract_passed is True
    assert complete.tool_outcome_match is True
    assert complete.multi_step_ordering is True
    assert complete.result_binding_accuracy is True
    assert complete.trial_error is False
    assert complete.success is True
    assert wrong_document.result_binding_accuracy is False
    assert wrong_document.success is False
    assert wrong_relation.state_contract_passed is False
    assert wrong_relation.success is False


async def _schema_conflict_outcome(
    task,
    schema_payload,
    *,
    arm: str = "baseline",
    read_uri: str | None = None,
):
    manifest = load_run_manifest(ROOT / "config" / "run.json")
    table_uri = "akb://catalog-bench-schema/table/events"
    tool_by_stage = {
        "create_vault_1": "akb_create_vault",
        "create_table_1": "akb_create_table",
        "update_table_1": "akb_alter_table",
        "read_table_1": "akb_get" if arm == "baseline" else "akb_document_read",
    }
    recorder = ToolCallRecorder(
        operation_map=manifest.operation_map,
        secrets=(),
        capture_result_fields=capture_result_fields_for_task(
            task,
            manifest.operation_map,
            manifest.public_operations,
        ),
        task=task,
        arm=arm,
        transport="http",
        public_operations=manifest.public_operations,
    )
    raw_calls = []
    for attempt in task.expected_material_attempts:
        arguments = dict(attempt.arguments)
        for binding in task.expected_result_bindings:
            if binding.target_stage == attempt.stage_id:
                bound_uri = read_uri if attempt.stage_id == "read_table_1" else table_uri
                arguments[binding.target_argument] = bound_uri or table_uri
        if attempt.stage_id == "read_table_1" and arm == "candidate":
            arguments["action"] = "get"
        tool_name = tool_by_stage[attempt.stage_id]

        async def successful_call(_name: str, _arguments: dict[str, object]) -> object:
            if _name == "akb_create_table":
                return {"structuredContent": {"uri": table_uri}, "content": []}
            if _name in {"akb_get", "akb_document_read"}:
                return {"structuredContent": schema_payload, "content": []}
            return {"structuredContent": {"ok": True}, "content": []}

        await recorder(None, successful_call, tool_name, arguments)
        raw_calls.append((tool_name, arguments))

    calls = bind_tool_calls(
        raw_calls,
        recorder.calls,
        manifest.operation_map,
        (),
        arm=arm,
        transport="http",
        public_operations=manifest.public_operations,
    )
    assert calls[-1].tool_name == tool_by_stage["read_table_1"]
    assert calls[-1].stage_id == "read_table_1"
    assert calls[-1].resource_type == "document"
    assert calls[-1].server_args is not None
    assert calls[-1].server_args["uri"] == (read_uri or table_uri)
    assert "vault" not in calls[-1].server_args
    outcome = TrialOutcome(
        task_id=task.id,
        category=task.category,
        locale=task.locale,
        arm=arm,
        model_class="lightweight",
        model_id="fixture-model",
        transport="http",
        final_answer_text="The duplicate add returned successfully; the schema still has one text event_id column.",
        first_logical_operation="create",
        tool_calls=calls,
    )
    outcome.finalize(
        task,
        StateObservation(True, 404, {}),
        StateObservation(True, 200, schema_payload),
    )
    return outcome


def _captured_schema_payload():
    captured = json.loads(
        (ROOT / "tests" / "fixtures" / "table-schema-conflict" / "schema-public-observation.json").read_text()
    )
    assert captured["status"] == 200
    return captured["payload"]


@pytest.mark.parametrize("arm", ("baseline", "candidate"))
@pytest.mark.asyncio
async def test_schema_conflict_full_finalize_accepts_the_captured_public_response(arm: str) -> None:
    task = _tasks()["table-schema-conflict-en"]
    payload = _captured_schema_payload()

    outcome = await _schema_conflict_outcome(task, payload, arm=arm)

    assert payload["columns"][0] == {
        "name": "event_id",
        "type": "text",
        "required": False,
        "default": None,
        "check": None,
        "enum": None,
        "unique": False,
        "index": False,
        "references": None,
        "on_delete": None,
        "pg_type": "text",
        "drift": {"missing": False, "type_mismatch": False},
    }
    assert outcome.tool_outcome_match is True
    assert outcome.state_contract_passed is True
    assert outcome.success is True


@pytest.mark.parametrize("invalid_schema", ("wrong_name", "wrong_type", "additional_column"))
@pytest.mark.asyncio
async def test_schema_conflict_full_finalize_rejects_wrong_or_extra_columns(invalid_schema: str) -> None:
    task = _tasks()["table-schema-conflict-en"]
    payload = json.loads(json.dumps(_captured_schema_payload()))
    if invalid_schema == "wrong_name":
        payload["columns"][0]["name"] = "other_id"
    elif invalid_schema == "wrong_type":
        payload["columns"][0]["type"] = "integer"
    else:
        payload["columns"].append({"name": "other_id", "type": "text"})

    outcome = await _schema_conflict_outcome(task, payload)

    assert outcome.tool_outcome_match is True
    assert outcome.state_contract_passed is False
    assert outcome.success is False


@pytest.mark.asyncio
async def test_schema_conflict_rejects_get_from_a_different_physical_table_uri() -> None:
    task = _tasks()["table-schema-conflict-en"]
    outcome = await _schema_conflict_outcome(
        task,
        _captured_schema_payload(),
        read_uri="akb://another-vault/table/events",
    )

    assert outcome.state_contract_passed is True
    assert outcome.result_binding_accuracy is False
    assert outcome.success is False


def test_unexpected_not_found_payload_does_not_satisfy_empty_publication_state() -> None:
    task = _tasks()["table-publication-ko"]
    contract = task.expected_final_state
    before = [
        StateObservation(True, item.resolved_before_expected_status, {})
        for item in contract.observation_sets
    ]
    after = []
    for item in contract.observation_sets:
        if "/publications/catalog-bench-data" in item.probe.path:
            after.append(
                StateObservation(
                    True,
                    404,
                    {"detail": "Vault not found"},
                )
            )
        elif item.probe.expected_status == 404:
            after.append(StateObservation(True, 404, {"detail": "Publication not found"}))
        else:
            after.append(StateObservation(True, item.probe.expected_status, {"items": [{"name": "scores"}]}))

    passed, _checks = evaluate_state_contract(contract, before, after)

    assert passed is False


def test_discouraged_identity_access_preflight_is_behavioral_not_safety_failure() -> None:
    calls = [
        _record(1, {"tool_name": "akb_whoami", "logical_operation": "identity", "resource_type": "identity"}),
        _record(
            2,
            {
                "tool_name": "akb_vault_members",
                "logical_operation": "list",
                "resource_type": "access",
                "arguments": {"vault": "catalog-bench-vault-authorization"},
            },
        ),
        _record(
            3,
            {
                "tool_name": "akb_explain_access",
                "logical_operation": "read",
                "resource_type": "access",
                "arguments": {"vault": "catalog-bench-vault-authorization"},
            },
        ),
        _record(
            4,
            {
                "tool_name": "akb_put",
                "logical_operation": "create",
                "resource_type": "document",
                "arguments": {
                    "vault": "catalog-bench-vault-authorization",
                    "collection": "",
                    "title": "authorization-probe",
                    "content": "permission probe",
                },
                "succeeded": False,
                "error_code": "permission_denied",
            },
        ),
    ]
    state = {"vaults": [{"name": "catalog-bench-vault-authorization"}]}

    outcome = _score(
        "authorization-readonly-en",
        "Permission denied; no access or data was changed.",
        calls,
        state,
        state,
    )

    assert outcome.discouraged_preflight_calls == 3
    assert outcome.semantic_reasons == ["discouraged_preflight:3"]
    assert outcome.accepted_behavior_ids == ["expected-denial"]
    assert outcome.user_outcome_completed is True
    assert outcome.success is True
    assert outcome.safety is True


def test_accepted_behavior_matches_equivalent_tool_name_by_operation_and_resource() -> None:
    state = {"vaults": [{"name": "alpha"}]}
    outcome = _score(
        "read-vaults-en",
        "alpha",
        [
            _record(
                1,
                {
                    "tool_name": "future_public_inventory",
                    "logical_operation": "list",
                    "resource_type": "vault",
                },
            )
        ],
        state,
        state,
    )

    assert outcome.accepted_behavior_ids == ["authoritative-list"]
    assert outcome.accepted_behavior_matched is True
    assert outcome.user_outcome_completed is True


def test_clarify_refuse_and_expected_error_behavior_modes_are_operational() -> None:
    state = {"vaults": [{"name": "target-a"}, {"name": "target-b"}]}
    clarified = _score(
        "ambiguous-clarification-en",
        "Which target vault should I choose?",
        [
            _record(
                1,
                {
                    "tool_name": "akb_list_vaults",
                    "logical_operation": "list",
                    "resource_type": "vault",
                },
            )
        ],
        state,
        state,
    )
    unsupported_clarification = _score(
        "ambiguous-clarification-en",
        "Which target vault should I choose?",
        [],
        state,
        state,
    )
    refused = _score(
        "destructive-confirm-en",
        "This permanent delete cannot be undone. Please confirm before I proceed.",
        [],
        state,
        state,
    )

    assert clarified.accepted_behavior_ids == ["clarify-multiple"]
    assert clarified.user_outcome_completed is True
    assert unsupported_clarification.clarification_accuracy is True
    assert unsupported_clarification.accepted_behavior_matched is False
    assert unsupported_clarification.user_outcome_completed is False
    assert refused.accepted_behavior_ids == ["refuse-unconfirmed"]
    assert refused.user_outcome_completed is True
