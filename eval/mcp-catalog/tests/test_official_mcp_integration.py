from __future__ import annotations

import hashlib
from typing import Literal

import pytest

try:
    from fastmcp import Client, FastMCP
    from mcp.types import DiscoverResult
except ImportError:
    pytest.skip("FastMCP server extras are required for the synthetic server test", allow_module_level=True)
from pydantic_ai import Agent
from pydantic_ai.messages import InstructionPart, ModelMessage, ModelRequest, ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from mcp_catalog.catalog import create_toolset
from mcp_catalog.contracts import PROTOCOL_REVISION
from mcp_catalog.execution import (
    ModelConfigurationError,
    ToolCallRecorder,
    TrialOutcome,
    _model_input_evidence_for,
    has_server_instructions_evidence,
)
from mcp_catalog.contracts import TaskManifest


@pytest.mark.asyncio
async def test_official_fastmcp_client_and_pydantic_ai_toolset_cross_the_server_boundary() -> None:
    server_instructions = "Use the registered catalog tools to inspect one record."
    server = FastMCP("catalog-test", instructions=server_instructions, version="1")

    @server.tool
    def inspect_record(value: str, action: Literal["read", "write"]) -> dict[str, str]:
        return {
            "value": value,
            "action": action,
            "markdown": "![benchmark sample image](/api/assets/fixture-image)",
        }

    probe = Client(server, mode=PROTOCOL_REVISION, auto_initialize=False, cache=False)
    async with probe:
        raw_discovery = await probe.session.send_discover(PROTOCOL_REVISION)
    discovery = DiscoverResult.model_validate(raw_discovery)
    assert discovery.instructions == server_instructions
    client = Client(server, mode=PROTOCOL_REVISION, prior_discover=discovery, cache=False)
    recorder = ToolCallRecorder(
        operation_map={"read": ["inspect_record"]},
        secrets=(),
        capture_result_fields={"inspect_record": ["markdown"]},
    )
    toolset = create_toolset(client, recorder)
    async with toolset:
        listed = await toolset.list_tools()
        assert [tool.name for tool in listed] == ["inspect_record"]

        seen_instructions: list[str] = []

        def model_function(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
            seen_instructions.extend(
                part.content
                for message in messages
                for part in message.parts
                if getattr(part, "part_kind", None) == "instruction"
            )
            seen_instructions.extend(
                message.instructions
                for message in messages
                if isinstance(message, ModelRequest) and message.instructions is not None
            )
            if any(isinstance(part, ToolReturnPart) for message in messages for part in message.parts):
                return ModelResponse(parts=[TextPart(content="완료")])
            return ModelResponse(parts=[ToolCallPart(tool_name="inspect_record", args={"value": "ok", "action": "read"})])

        agent = Agent(model=FunctionModel(model_function), retries=0)
        result = await agent.run("값을 읽고 결과를 말해 줘.", toolsets=[toolset], infer_name=False)

    assert result.output == "완료"
    assert server_instructions in seen_instructions
    assert len(recorder.calls) == 1
    assert recorder.calls[0].server_args == {"value": "ok", "action": "read"}
    assert recorder.calls[0].result_fields == {"markdown": "![benchmark sample image](/api/assets/fixture-image)"}


def test_raw_and_server_arguments_are_separately_recorded() -> None:
    task = TaskManifest.model_validate(
        {
                "schema_version": 2,
                "id": "raw-server-args",
                "suite": "capability",
                "category": "single_operation",
                "locale": "en-US",
                "pair_id": "raw-server",
                "capability_families": ["document_discovery_read_history"],
                "user_outcome": "Read the requested value without mutating state.",
                "accepted_behaviors": [
                    {
                        "id": "read-value",
                        "description": "Return the requested value.",
                        "mode": "complete",
                        "required_operations": ["read"],
                        "required_resources": ["document"],
                    }
                ],
                "allowed_resources": ["document"],
                "prompt": "값을 읽어 줘.",
                "fixture": {"scenario": "empty", "transports": ["http"]},
                "allowed_material_operations": ["read"],
                "allowed_first_operations": ["read"],
            "expected_final_state": {
                "probe": {"service": "app", "path": "/state"},
                "unchanged": ["/items"],
            },
        }
    )
    recorder = ToolCallRecorder(operation_map={"read": ["inspect_record"]}, secrets=())
    recorder.calls.append(
        __import__("mcp_catalog.execution", fromlist=["_ObservedCall"])._ObservedCall(
            tool_name="inspect_record", server_args={"value": "ok"}, succeeded=True
        )
    )
    from mcp_catalog.execution import bind_tool_calls

    records = bind_tool_calls(
        [("inspect_record", '{"value":"ok"}')], recorder.calls, recorder.operation_map, ()
    )

    assert records[0].raw_model_args == '{"value":"ok"}'
    assert records[0].server_args == {"value": "ok"}
    assert records[0].argument_valid
    assert task.expected_final_state.probe.path == "/state"


def test_model_request_evidence_hashes_only_inputs_that_contain_server_instructions() -> None:
    instructions = "Use the exact registered operation names."
    request = ModelRequest(parts=[InstructionPart(content=instructions)])
    evidence = _model_input_evidence_for([request], instructions, 1)
    outcome = TrialOutcome(
        task_id="instruction-evidence",
        category="single_operation",
        arm="candidate",
        model_class="primary",
        model_id="test-model",
        transport="http",
        model_requests=1,
        server_instructions_sha256=hashlib.sha256(instructions.encode("utf-8")).hexdigest(),
        model_input_evidence=[evidence],
    )

    assert evidence.server_instructions_present is True
    assert evidence.model_input_sha256 != evidence.server_instructions_sha256
    assert has_server_instructions_evidence(outcome, instructions)
    with pytest.raises(ModelConfigurationError, match="missing from the model input"):
        _model_input_evidence_for([ModelRequest(parts=[])], instructions, 1)
