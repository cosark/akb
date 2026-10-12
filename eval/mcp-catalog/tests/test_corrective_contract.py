from __future__ import annotations

from pathlib import Path

import pytest
from pydantic_ai.exceptions import ToolFailed
from pydantic_ai.messages import ToolReturnPart

from mcp_catalog.contracts import load_run_manifest, load_task_corpus
from mcp_catalog.execution import (
    ToolCallRecord,
    ToolCallRecorder,
    TrialOutcome,
    _arguments_include,
    _fabricated_resource_claim_count,
    _redact_vault_skill_ack,
    _vault_skill_handshakes_are_valid,
    bind_tool_calls,
    capture_result_fields_for_task,
)

ROOT = Path(__file__).parents[1]


@pytest.mark.asyncio
async def test_tool_failed_is_a_completed_mcp_application_error() -> None:
    recorder = ToolCallRecorder(operation_map={}, secrets=())

    async def failed_call(_name: str, _arguments: dict[str, object]) -> object:
        raise ToolFailed(
            'ToolReturnPart(tool_name="akb_put", content='
            '{"code":"invalid_argument","vault":"catalog-bench","name":"scores"})'
        )

    with pytest.raises(ToolFailed):
        await recorder(None, failed_call, "akb_put", {"vault": "catalog-bench"})

    observed = recorder.calls[0]
    assert observed.transport_succeeded is True
    assert observed.status_code is None
    assert observed.error_code == "invalid_argument"
    assert observed.error_identity == {"vault": "catalog-bench", "name": "scores"}


def test_ack_token_is_redacted_from_prefixed_exception_json() -> None:
    message = 'ToolReturnPart(content={"vault_skill":{"ack_token":"secret-ack"},"code":"vault_skill_required"})'

    redacted = _redact_vault_skill_ack(message)

    assert "secret-ack" not in redacted
    assert "ToolReturnPart(content=" in redacted
    assert '"code":"vault_skill_required"' in redacted


def test_nested_object_fields_are_required_without_requiring_optional_metadata() -> None:
    expected = {"columns": [{"name": "event_id", "type": "text"}]}

    assert _arguments_include(
        {"columns": [{"name": "event_id", "type": "text", "description": "Event identifier"}]},
        expected,
    )
    assert not _arguments_include(
        {"columns": [{"name": "id", "type": "text", "description": "Event identifier"}]},
        expected,
    )
    assert not _arguments_include(
        {"columns": [{"name": "event_id", "type": "text", "default": ""}]},
        expected,
    )


@pytest.mark.asyncio
async def test_vault_skill_ack_pair_has_a_redacted_reproducible_request_binding() -> None:
    manifest = load_run_manifest(ROOT / "config" / "run.json")
    task = next(task for task in load_task_corpus(ROOT / "corpus" / "tasks.json") if task.id == "table-publication-en")
    recorder = ToolCallRecorder(
        operation_map=manifest.operation_map,
        secrets=(),
        capture_result_fields=capture_result_fields_for_task(task, manifest.operation_map),
        task=task,
        arm="candidate",
        transport="http",
        public_operations=manifest.public_operations,
    )
    arguments = {
        "resource_type": "table_query",
        "vault": "catalog-bench-data",
        "query_sql": "SELECT * FROM scores LIMIT 5",
    }
    error_message = ToolReturnPart(
        tool_name="akb_publish",
        content={
            "code": "vault_skill_required",
            "vault": "catalog-bench-data",
            "vault_skill": {"ack_token": "secret-ack", "operation": "publish"},
        },
    ).model_response_str(wrap_if_error=False)

    async def first_call(_name: str, _args: dict[str, object]) -> object:
        raise ToolFailed(error_message)

    with pytest.raises(ToolFailed):
        await recorder(None, first_call, "akb_publish", arguments)

    async def retry_call(_name: str, _args: dict[str, object]) -> object:
        return {"structuredContent": {"slug": "sample-slug"}, "content": []}

    await recorder(None, retry_call, "akb_publish", {**arguments, "_vault_skill_ack": "secret-ack"})
    records = bind_tool_calls(
        [("akb_publish", arguments), ("akb_publish", arguments)],
        recorder.calls,
        manifest.operation_map,
        (),
        input_schemas={"akb_publish": {"properties": {}}},
        arm="candidate",
        transport="http",
        public_operations=manifest.public_operations,
    )

    assert records[0].transport_succeeded is True
    assert records[0].server_status_code is None
    assert records[0].server_error_code == "vault_skill_required"
    assert records[0].server_error_identity == {"vault": "catalog-bench-data"}
    assert records[0].stage_id == records[1].stage_id == "create_publication_1"
    assert records[0].vault_skill_binding_sha256 == records[1].vault_skill_binding_sha256
    assert records[0].vault_skill_binding_sha256 is not None
    assert _vault_skill_handshakes_are_valid(records)
    serialized = str([record.model_dump(mode="json") for record in records])
    assert "secret-ack" not in serialized
    assert "secret-ack" not in (records[0].error or "")


def test_corrected_task_oracles_cover_schema_and_cleanup_boundaries() -> None:
    tasks = {task.id: task for task in load_task_corpus(ROOT / "corpus" / "tasks.json")}
    for task_id in ("table-schema-conflict-ko", "table-schema-conflict-en"):
        task = tasks[task_id]
        create, conflict, _verify = task.expected_material_attempts[1:]
        assert create.arguments["columns"] == [{"name": "event_id", "type": "text"}]
        assert conflict.arguments["add_columns"] == [{"name": "event_id", "type": "text"}]
        assert conflict.outcome == "success"
        assert conflict.status_code is None
        assert conflict.error_code is None
        assert "actual response" in task.prompt or "실제로 반환한 결과" in task.prompt
        assert task.expected_final_state.must[0].value == [{"name": "event_id", "type": "text"}]

    for task_id in ("table-publication-ko", "table-publication-en"):
        task = tasks[task_id]
        snapshot = next(item for item in task.expected_material_attempts if item.stage_id == "read_publication_1")
        assert snapshot.arguments == {}
        assert any(binding.target_stage == snapshot.stage_id and binding.target_argument == "slug" for binding in task.expected_result_bindings)

    for task_id in ("stdio-image-files-ko", "stdio-image-files-en"):
        task = tasks[task_id]
        assert "akb_put" not in task.prompt
        assert "akb_put_file" not in task.prompt
        image = next(item for item in task.expected_material_attempts if item.logical_operation == "image_upload")
        image_probe = next(item for item in task.expected_final_state.observation_sets if item.probe.result_binding)
        assert image_probe.probe.result_binding.source_stage == image.stage_id


def test_markdown_delimiter_is_not_part_of_a_confirmed_resource_uri() -> None:
    task = next(task for task in load_task_corpus(ROOT / "corpus" / "tasks.json") if task.id == "create-vault-ko")
    uri = "akb://catalog-bench-vault/doc/created.md"
    outcome = TrialOutcome(
        task_id=task.id,
        category=task.category,
        locale=task.locale,
        arm="baseline",
        model_class="primary",
        model_id="model",
        transport="http",
        final_answer_text=f"Created `{uri}`.",
    )
    outcome.tool_calls = [ToolCallRecord(order=1, tool_name="akb_put", logical_operation="create", result_preview=uri)]

    assert _fabricated_resource_claim_count(outcome, task) == 0
