from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

import mcp_catalog.cli as cli_module
import mcp_catalog.selection as selection_module
from mcp_catalog.contracts import hash_json, load_run_manifest, load_task_corpus
from mcp_catalog.execution import TrialOutcome
from mcp_catalog.runner import BenchmarkRunner, PairedArmCoordinator, planned_arm_order
from mcp_catalog.runtime import RuntimeDescriptor
from test_runtime_contract import descriptor_dict

ROOT = Path(__file__).parents[1]


def _manifest():
    manifest = load_run_manifest(ROOT / "config" / "run.json")
    budget = manifest.budget.model_copy(
        update={
            "max_total_cost_usd": 50,
            "max_cost_per_trial_usd": 0.10,
            "request_timeout_seconds": 300,
        }
    )
    models = [
        model.model_copy(
            update={
                "routing": model.routing.model_copy(update={"order": ["streamlake"]}),
                "input_cost_per_million_usd": 0.088,
                "output_cost_per_million_usd": 0.264,
            }
        )
        if model.class_name == "primary"
        else model
        for model in manifest.models
    ]
    return manifest.model_copy(update={"budget": budget, "models": models})


def _selection_fixture(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[Any, list[Any], selection_module.ToolGuidanceSelection]:
    manifest = _manifest()
    tasks = load_task_corpus(ROOT / "corpus" / "tasks.json")
    selected = [
        {
            "model_class": model_class,
            "transport": transport,
            "task_id": task_id,
            "repeat_index": repeat_index,
            "role": role,
            "parent_lineage": "previous",
        }
        for (model_class, transport, task_id, repeat_index), role
        in selection_module._ROLE_BY_IDENTITY.items()
    ]
    parent_bindings: dict[str, dict[str, str]] = {}
    tmp_path.mkdir(parents=True, exist_ok=True)
    for arm in ("baseline", "candidate"):
        name = f"previous_{arm}"
        rows = []
        for trial in selected:
            rows.append(
                {
                    **{key: trial[key] for key in ("model_class", "transport", "task_id", "repeat_index")},
                    "arm": arm,
                    "success": not (arm == "candidate" and trial["role"] == "failure"),
                    "failure_kind": "none",
                }
            )
        artifact = {
            "arm": arm,
            "runs": {
                f"primary:{transport}": {
                    "trials": [row for row in rows if row["transport"] == transport]
                }
                for transport in ("http", "stdio")
            },
        }
        path = tmp_path / f"{name}.json"
        raw = json.dumps(artifact, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        path.write_bytes(raw)
        digest = hashlib.sha256(raw).hexdigest()
        parent_bindings[name] = {"path": str(path), "sha256": digest}

    document = {
        "schema_version": 1,
        "authorization": {
            "uri": "akb://reef-akb/coll/issues/doc/akb-361.md",
            "revision": "a" * 40,
            "content_sha256": "b" * 64,
        },
        "parents": parent_bindings,
        "selected_trials": selected,
        "budget": {
            "session_max_usd": "50",
            "prior_conservative_spend_usd": str(selection_module.PRIOR_SPEND_USD),
            "new_execution_limit_usd": str(selection_module.NEW_EXECUTION_LIMIT_USD),
            "per_trial_usd": "0.10",
            "request_timeout_seconds": 300,
        },
    }
    selection_path = tmp_path / "selection.json"
    selection_path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    selection = selection_module.ToolGuidanceSelection.load(
        selection_path,
        manifest=manifest,
        tasks=tasks,
    )
    return manifest, tasks, selection


def test_selection_validates_all_pinned_parent_rows_without_writing_them(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest, tasks, selection = _selection_fixture(tmp_path, monkeypatch)
    parent_bytes = {name: Path(item["path"]).read_bytes() for name, item in selection.parents.items()}
    loaded = selection_module.ToolGuidanceSelection.load(selection.path, manifest=manifest, tasks=tasks)

    assert loaded.sha256 == selection.sha256
    assert len(loaded.selected_trials) == 14
    assert sum(trial.role == "failure" for trial in loaded.selected_trials) == 6
    assert sum(trial.role == "control" for trial in loaded.selected_trials) == 8
    assert {name: Path(item["path"]).read_bytes() for name, item in loaded.parents.items()} == parent_bytes


def test_failure_role_requires_candidate_failure_without_constraining_failure_kind(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest, tasks, selection = _selection_fixture(tmp_path, monkeypatch)
    candidate_path = Path(selection.parents["previous_candidate"]["path"])
    candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
    candidate_failures = [
        row
        for run in candidate["runs"].values()
        for row in run["trials"]
        if not row["success"]
    ]
    assert candidate_failures
    assert all(row["failure_kind"] == "none" for row in candidate_failures)
    selection_module.ToolGuidanceSelection.load(selection.path, manifest=manifest, tasks=tasks)

    candidate_failures[0]["success"] = True
    raw = json.dumps(candidate, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    candidate_path.write_bytes(raw)
    document = json.loads(selection.path.read_text(encoding="utf-8"))
    document["parents"]["previous_candidate"]["sha256"] = hashlib.sha256(raw).hexdigest()
    selection.path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    with pytest.raises(ValueError, match="prior candidate failure"):
        selection_module.ToolGuidanceSelection.load(selection.path, manifest=manifest, tasks=tasks)


def test_selection_requires_the_approved_streamlake_primary_route(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest, tasks, selection = _selection_fixture(tmp_path, monkeypatch)
    assert next(model for model in manifest.models if model.class_name == "primary").routing.order == ["streamlake"]
    assert next(model for model in manifest.models if model.class_name == "lightweight").routing.order == ["akashml"]

    for model_class, wrong_provider in (("primary", "deepinfra"), ("lightweight", "streamlake")):
        wrong_models = [
            model.model_copy(update={"routing": model.routing.model_copy(update={"order": [wrong_provider]})})
            if model.class_name == model_class
            else model
            for model in manifest.models
        ]
        wrong_manifest = manifest.model_copy(update={"models": wrong_models})
        with pytest.raises(ValueError, match="approved fixed provider routes"):
            selection_module.ToolGuidanceSelection.load(
                selection.path,
                manifest=wrong_manifest,
                tasks=tasks,
            )


def test_relative_parent_paths_resolve_from_the_selection_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest, tasks, selection = _selection_fixture(tmp_path, monkeypatch)
    document = json.loads(selection.path.read_text(encoding="utf-8"))
    for binding in document["parents"].values():
        binding["path"] = Path(binding["path"]).name
    selection.path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    monkeypatch.chdir(tmp_path.parent)

    loaded = selection_module.ToolGuidanceSelection.load(
        selection.path,
        manifest=manifest,
        tasks=tasks,
    )

    assert all(Path(parent["path"]).is_absolute() for parent in loaded.parents.values())


def test_selection_requires_the_minimal_approved_plan_and_exact_budget(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest, tasks, selection = _selection_fixture(tmp_path, monkeypatch)
    document = json.loads(selection.path.read_text(encoding="utf-8"))
    assert set(document) == {"schema_version", "authorization", "parents", "selected_trials", "budget"}
    document["budget"]["new_execution_limit_usd"] = "41.2500298149"
    selection.path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    with pytest.raises(ValueError, match="budget"):
        selection_module.ToolGuidanceSelection.load(selection.path, manifest=manifest, tasks=tasks)


@pytest.mark.parametrize("mutation", ["duplicate", "missing", "extra", "wrong_role", "wrong_lineage"])
def test_selection_rejects_identity_or_role_changes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mutation: str,
) -> None:
    manifest, tasks, selection = _selection_fixture(tmp_path, monkeypatch)
    document = json.loads(selection.path.read_text(encoding="utf-8"))
    if mutation == "duplicate":
        document["selected_trials"].append(document["selected_trials"][0])
    elif mutation == "missing":
        document["selected_trials"].pop()
    elif mutation == "extra":
        document["selected_trials"][0]["task_id"] = "unknown-task"
    elif mutation == "wrong_role":
        document["selected_trials"][0]["role"] = "control"
    else:
        document["selected_trials"][0]["parent_lineage"] = "original"
    selection.path.write_text(json.dumps(document), encoding="utf-8")

    with pytest.raises(ValueError):
        selection_module.ToolGuidanceSelection.load(selection.path, manifest=manifest, tasks=tasks)


def test_selection_rejects_parent_drift_and_budget_drift(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest, tasks, selection = _selection_fixture(tmp_path, monkeypatch)
    parent = Path(selection.parents["previous_baseline"]["path"])
    parent.write_bytes(parent.read_bytes() + b" ")
    with pytest.raises(ValueError, match="SHA-256"):
        selection_module.ToolGuidanceSelection.load(selection.path, manifest=manifest, tasks=tasks)

    _manifest_again, _tasks_again, second = _selection_fixture(tmp_path / "budget", monkeypatch)
    wrong_budget = manifest.budget.model_copy(update={"max_cost_per_trial_usd": 0.11})
    with pytest.raises(ValueError, match="measurement budget"):
        selection_module.ToolGuidanceSelection.load(
            second.path,
            manifest=manifest.model_copy(update={"budget": wrong_budget}),
            tasks=tasks,
        )


def test_selection_filters_schedules_and_hashes_its_pre_smoke_seal(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest, tasks, selection = _selection_fixture(tmp_path, monkeypatch)
    descriptor = RuntimeDescriptor.from_dict(descriptor_dict())
    runner = BenchmarkRunner(manifest, tasks, descriptor, selection=selection)
    planned = runner._planned_keys(manifest.arm_source_revisions["baseline"])
    coordinator = PairedArmCoordinator(manifest, tasks, selection=selection)

    assert len(planned) == 14
    assert sum(map(len, coordinator._schedule.values())) == 28
    assert all(selection.contains(key.model_class, key.transport, key.task_id, key.repeat_index) for key in planned.values())
    runtime = {"source_revision": manifest.arm_source_revisions["baseline"], "artifact_versions": {}}
    seal = runner._local_pre_smoke_seal(runtime, {})
    assert seal["selection"]["selection_sha256"] == selection.sha256
    assert seal["selection"]["authorization"] == selection.authorization.model_dump(mode="json")
    changed = selection.__class__(
        path=selection.path,
        sha256="f" * 64,
        authorization=selection.authorization,
        budget=selection.budget,
        parents=selection.parents,
        selected_trials=selection.selected_trials,
        parent_results=selection.parent_results,
    )
    changed_seal = BenchmarkRunner(manifest, tasks, descriptor, selection=changed)._local_pre_smoke_seal(runtime, {})
    assert hash_json(seal) != hash_json(changed_seal)


@pytest.mark.asyncio
async def test_selection_resume_restores_contiguous_terminal_arm_events(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest, tasks, selection = _selection_fixture(tmp_path, monkeypatch)
    coordinator = PairedArmCoordinator(manifest, tasks, selection=selection)
    reused: dict[str, dict[tuple[str, str, int], TrialOutcome]] = {"baseline": {}, "candidate": {}}
    sequence = 0
    model_ids = {item.class_name: item.model_id for item in manifest.models}
    for cell, schedule in coordinator._schedule.items():
        model_class, transport = cell.split(":", 1)
        for task_id, repeat_index, arm in schedule:
            sequence += 1
            order = planned_arm_order(task_id, repeat_index, manifest.paired_order_seed)
            reused[arm][(cell, task_id, repeat_index)] = TrialOutcome(
                task_id=task_id,
                category="single_operation",
                arm=arm,
                model_class=model_class,
                model_id=model_ids[model_class],
                transport=transport,
                repeat_index=repeat_index,
                paired_order_position=order.index(arm),
                paired_execution_sequence=sequence,
            )

    await coordinator.register_arm("baseline", reused["baseline"])
    await coordinator.register_arm("candidate", reused["candidate"])

    assert len(coordinator.evidence()["events"]) == 28
    assert coordinator.evidence()["complete"] is True


@pytest.mark.asyncio
async def test_cli_uses_new_selection_ledger_and_writes_separate_summary(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest, tasks, selection = _selection_fixture(tmp_path, monkeypatch)
    descriptor = RuntimeDescriptor.from_dict(descriptor_dict())
    captured: list[dict[str, Any]] = []

    class Runner:
        def __init__(self, *_args: object, **kwargs: Any) -> None:
            self.arm = kwargs["arm"]
            self.secrets: tuple[str, ...] = ()
            captured.append(kwargs)

        async def run(self) -> dict[str, Any]:
            return {
                "schema_version": 2,
                "status": "incomplete",
                "arm": self.arm,
                "runs": {},
                "smoke_gate": {},
            }

    monkeypatch.setattr(cli_module, "load_inputs", lambda *_args: (manifest, tasks, descriptor))
    monkeypatch.setattr(cli_module, "BenchmarkRunner", Runner)
    args = SimpleNamespace(
        manifest=ROOT / "config" / "run.json",
        corpus=ROOT / "corpus" / "tasks.json",
        coverage=ROOT / "corpus" / "tool-coverage.json",
        baseline_descriptor=tmp_path / "baseline-descriptor.json",
        candidate_descriptor=tmp_path / "candidate-descriptor.json",
        baseline_output=tmp_path / "baseline-output.json",
        candidate_output=tmp_path / "candidate-output.json",
        comparison_output=tmp_path / "comparison.json",
        baseline_checkpoint=tmp_path / "baseline.checkpoint.json",
        candidate_checkpoint=tmp_path / "candidate.checkpoint.json",
        selection=selection.path,
        selection_summary_output=tmp_path / "selection-summary.json",
        resume=False,
    )

    result = await cli_module.run_paired(args)

    assert result == 1
    assert len(captured) == 2
    ledger = captured[0]["shared_ledger"]
    assert captured[1]["shared_ledger"] is ledger
    assert ledger.total_cost_limit_usd == Decimal("41.2500298148")
    assert ledger.requests == 0
    assert ledger.cost_usd == Decimal("0")
    assert all(item["selection"].sha256 == selection.sha256 for item in captured)
    assert json.loads(args.comparison_output.read_text(encoding="utf-8"))["verdict"] == "inconclusive"
    summary = json.loads(args.selection_summary_output.read_text(encoding="utf-8"))
    assert summary["status"] == "incomplete"
    assert summary["adopt_eligible"] is False
    assert summary["expected_new_model_trials"] == 28
