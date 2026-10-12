"""The explicitly approved AKB-361 tool-guidance regression sample."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, model_validator

from .contracts import (
    BenchmarkRunManifest,
    ContractModel,
    ModelSpec,
    TaskManifest,
    Transport,
)
from .execution import TrialOutcome, has_measured_evidence, has_server_instructions_evidence
from .pairing import planned_arm_order

WORK_ITEM = "AKB-361"
AUTHORIZATION_URI = "akb://reef-akb/coll/issues/doc/akb-361.md"
AUTHORIZATION_REVISION = "006b373f989aaad7ce497912fab437741648d625"  # pragma: allowlist secret
AUTHORIZATION_CONTENT_SHA256 = "0f5cb26f254f4eb2377b3798b9fe98a634e501196c2624200c53ed898899d1f8"  # pragma: allowlist secret
PROVIDER_RECOVERY_AUTHORIZATION_REVISION = "79718e4da22a2cb1f3d82167000009a57963b90e"  # pragma: allowlist secret
PROVIDER_RECOVERY_AUTHORIZATION_CONTENT_SHA256 = "c1379ac198acf601684c7c09ce71d2e99a95512381f0e31ec2a488e6822cab0b"  # pragma: allowlist secret
SELECTION_SOURCE_SHA256 = "be0ef3c434e57c4af4b453558f73bd3fcff3237b9effae07840fe64c2699a762"  # pragma: allowlist secret
TOTAL_BUDGET_USD = Decimal("50")
PRIOR_SPEND_USD = Decimal("8.56720104")
NEW_EXECUTION_LIMIT_USD = TOTAL_BUDGET_USD - PRIOR_SPEND_USD
PER_TRIAL_LIMIT_USD = Decimal("0.10")
REQUEST_TIMEOUT_SECONDS = 300

SelectionIdentity = tuple[str, str, str, int]
ParentLineage = Literal["recovery", "original"]
ParentName = Literal[
    "recovery_baseline",
    "recovery_candidate",
    "original_baseline",
    "original_candidate",
]

_PARENT_SHA256: dict[ParentName, str] = {
    "recovery_baseline": "e42af85c5ef0456ed5ee3f93b718a44b5e7aa2690fcb9fc68f77c51c3546efd3",  # pragma: allowlist secret
    "recovery_candidate": "11d3fe0445b9279b1a12016f34b004f7cfed9dcb668d506544f3b8759f030f54",  # pragma: allowlist secret
    "original_baseline": "5df67aaa44e4ecd8ec5067f136184fcf18c5fbe558876cc39c9a414697d8dfb7",  # pragma: allowlist secret
    "original_candidate": "28a23de2811a679b315c7069c4df2db8672218eb19da872aa41652d36db0d371",  # pragma: allowlist secret
}

_ROLE_BY_IDENTITY: dict[SelectionIdentity, tuple[Literal["failure", "control"], ParentLineage]] = {
    ("primary", "http", "collection-relation-lifecycle-ko", 2): ("failure", "recovery"),
    ("primary", "http", "table-schema-conflict-en", 2): ("failure", "recovery"),
    ("primary", "stdio", "identity-access-ko", 2): ("failure", "recovery"),
    ("primary", "stdio", "stdio-image-files-ko", 1): ("failure", "recovery"),
    ("primary", "stdio", "stdio-local-en", 2): ("failure", "recovery"),
    ("primary", "stdio", "table-publication-en", 1): ("failure", "recovery"),
    ("primary", "stdio", "table-publication-ko", 1): ("failure", "recovery"),
    ("primary", "stdio", "table-schema-conflict-en", 1): ("failure", "recovery"),
    ("primary", "http", "exhaustive-inspection-ko", 1): ("control", "recovery"),
    ("primary", "http", "ambiguous-clarification-ko", 2): ("control", "recovery"),
    ("primary", "http", "exhaustive-inspection-en", 2): ("control", "recovery"),
    ("primary", "http", "ambiguous-clarification-en", 2): ("control", "recovery"),
    ("primary", "stdio", "exhaustive-inspection-ko", 2): ("control", "recovery"),
    ("primary", "stdio", "stdio-local-ko", 2): ("control", "original"),
    ("primary", "stdio", "exhaustive-inspection-en", 2): ("control", "recovery"),
    ("primary", "stdio", "read-vaults-en", 2): ("control", "recovery"),
}


class AuthorizationPin(ContractModel):
    uri: Literal["akb://reef-akb/coll/issues/doc/akb-361.md"]
    revision: Literal["006b373f989aaad7ce497912fab437741648d625"]
    content_sha256: Literal["0f5cb26f254f4eb2377b3798b9fe98a634e501196c2624200c53ed898899d1f8"]


class ParentArtifact(ContractModel):
    path: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class SelectionBudget(ContractModel):
    session_max_usd: Decimal
    prior_conservative_spend_usd: Decimal
    new_execution_limit_usd: Decimal
    per_trial_usd: Decimal
    request_timeout_seconds: int
    request_count_limit: None
    wall_time_stop_limit: None


class SelectedTrial(ContractModel):
    model_class: Literal["primary", "lightweight"]
    transport: Transport
    task_id: str = Field(pattern=r"^[a-z][a-z0-9-]{2,63}$")
    repeat_index: int = Field(ge=1)
    role: Literal["failure", "control"]
    parent_lineage: ParentLineage
    prior_candidate_failure_kind: Literal["tool"] | None = None
    prior_both_arms_success: Literal[True] | None = None

    @property
    def identity(self) -> SelectionIdentity:
        return (self.model_class, self.transport, self.task_id, self.repeat_index)


class SelectionDocument(ContractModel):
    schema_version: Literal[1]
    authorization: AuthorizationPin
    parents: dict[ParentName, ParentArtifact]
    selected_trials: list[SelectedTrial] = Field(min_length=1)
    purpose: Literal["tool_guidance_regression"] | None = None
    selected_identity_count: int | None = Field(default=None, ge=0)
    new_trial_count: int | None = Field(default=None, ge=0)
    smoke_trial_count: int | None = Field(default=None, ge=0)
    comparison: str | None = None
    prepared_at: str | None = Field(default=None, min_length=1)
    budget: SelectionBudget | None = None

    @model_validator(mode="after")
    def validate_approved_selection(self) -> SelectionDocument:
        if set(self.parents) != {
            "recovery_baseline",
            "recovery_candidate",
            "original_baseline",
            "original_candidate",
        }:
            raise ValueError("selection must pin all four approved parent artifacts")
        if any(self.parents[name].sha256 != expected for name, expected in _PARENT_SHA256.items()):
            raise ValueError("selection parent artifact hashes differ from the approved evidence")
        identities = [trial.identity for trial in self.selected_trials]
        if len(set(identities)) != len(identities):
            raise ValueError("selection contains duplicate trial identities")
        if set(identities) != set(_ROLE_BY_IDENTITY):
            raise ValueError("selection identities differ from the approved AKB-361 sample")
        for trial in self.selected_trials:
            expected_role, expected_lineage = _ROLE_BY_IDENTITY[trial.identity]
            if (trial.role, trial.parent_lineage) != (expected_role, expected_lineage):
                raise ValueError("selection role or parent lineage differs from the approved sample")
            if trial.role == "failure":
                if trial.prior_both_arms_success is not None:
                    raise ValueError("prior success metadata is only valid for selected controls")
            elif trial.prior_candidate_failure_kind is not None:
                raise ValueError("prior failure metadata is only valid for selected failures")
        if Counter(trial.role for trial in self.selected_trials) != Counter(failure=8, control=8):
            raise ValueError("selection must contain eight failures and eight controls")
        if self.selected_identity_count is not None and self.selected_identity_count != len(self.selected_trials):
            raise ValueError("selection identity count differs from its selected trials")
        if self.new_trial_count is not None and self.new_trial_count != 2 * len(self.selected_trials):
            raise ValueError("selection paired trial count differs from its selected identities")
        if self.smoke_trial_count is not None and self.smoke_trial_count != 8:
            raise ValueError("selection smoke count differs from the four paired smoke cells")
        if self.budget is not None and (
            self.budget.session_max_usd != TOTAL_BUDGET_USD
            or self.budget.prior_conservative_spend_usd != PRIOR_SPEND_USD
            or self.budget.new_execution_limit_usd != NEW_EXECUTION_LIMIT_USD
            or self.budget.per_trial_usd != PER_TRIAL_LIMIT_USD
            or self.budget.request_timeout_seconds != REQUEST_TIMEOUT_SECONDS
            or self.budget.request_count_limit is not None
            or self.budget.wall_time_stop_limit is not None
        ):
            raise ValueError("selection budget metadata differs from the approved measurement limits")
        return self


@dataclass(frozen=True, slots=True)
class ToolGuidanceSelection:
    path: Path
    sha256: str
    parents: dict[str, dict[str, str]]
    selected_trials: tuple[SelectedTrial, ...]
    parent_results: dict[SelectionIdentity, dict[str, dict[str, Any]]]

    @property
    def identities(self) -> frozenset[SelectionIdentity]:
        return frozenset(trial.identity for trial in self.selected_trials)

    def contains(self, model_class: str, transport: str, task_id: str, repeat_index: int) -> bool:
        return (model_class, transport, task_id, repeat_index) in self.identities

    def artifact_metadata(self) -> dict[str, Any]:
        return {
            "work_item": WORK_ITEM,
            "purpose": "tool_guidance_regression",
            "authorization": {
                "uri": AUTHORIZATION_URI,
                "revision": AUTHORIZATION_REVISION,
                "content_sha256": AUTHORIZATION_CONTENT_SHA256,
            },
            "provider_recovery_authorization": {
                "uri": AUTHORIZATION_URI,
                "revision": PROVIDER_RECOVERY_AUTHORIZATION_REVISION,
                "content_sha256": PROVIDER_RECOVERY_AUTHORIZATION_CONTENT_SHA256,
            },
            "selection_sha256": self.sha256,
            "selection_source_sha256": SELECTION_SOURCE_SHA256,
            "parents": {name: dict(parent) for name, parent in sorted(self.parents.items())},
            "selected_trials": [trial.model_dump(mode="json") for trial in self.selected_trials],
            "selected_identity_count": len(self.selected_trials),
            "expected_model_trials": 2 * len(self.selected_trials),
            "budget": {
                "registered_total_cap_usd": str(TOTAL_BUDGET_USD),
                "prior_spend_basis_usd": str(PRIOR_SPEND_USD),
                "new_execution_limit_usd": str(NEW_EXECUTION_LIMIT_USD),
                "trial_cost_limit_usd": str(PER_TRIAL_LIMIT_USD),
                "request_timeout_seconds": REQUEST_TIMEOUT_SECONDS,
                "request_count_limit": None,
                "overall_wall_time_limit_seconds": None,
            },
        }

    @classmethod
    def load(
        cls,
        path: Path,
        *,
        manifest: BenchmarkRunManifest,
        tasks: list[TaskManifest],
    ) -> ToolGuidanceSelection:
        try:
            path = path.expanduser().resolve(strict=True)
            raw = path.read_bytes()
        except (OSError, RuntimeError) as exc:
            raise ValueError("selection file is unavailable") from exc
        selection_sha256 = hashlib.sha256(raw).hexdigest()
        try:
            document = SelectionDocument.model_validate_json(raw)
        except (ValueError, UnicodeDecodeError) as exc:
            raise ValueError(f"selection file is invalid: {exc}") from exc
        _validate_manifest(manifest, document.selected_trials, tasks)
        parents = _validate_parents(document.parents, selection_directory=path.parent)
        return cls(
            path=path,
            sha256=selection_sha256,
            parents=parents,
            selected_trials=tuple(document.selected_trials),
            parent_results=_parent_results(parents, document.selected_trials),
        )


def _validate_manifest(
    manifest: BenchmarkRunManifest,
    selected_trials: list[SelectedTrial],
    tasks: list[TaskManifest],
) -> None:
    budget = manifest.budget
    if set(manifest.arms) != {"baseline", "candidate"} or set(manifest.transports) != {"http", "stdio"}:
        raise ValueError("run manifest does not contain the approved paired transports and arms")
    if (
        Decimal(str(budget.max_total_cost_usd)) != TOTAL_BUDGET_USD
        or Decimal(str(budget.max_cost_per_trial_usd)) != PER_TRIAL_LIMIT_USD
        or budget.request_timeout_seconds != REQUEST_TIMEOUT_SECONDS
    ):
        raise ValueError("run manifest differs from the approved tool-guidance measurement budget")
    expected_routes: dict[Literal["primary", "lightweight"], str] = {
        "primary": "streamlake",
        "lightweight": "akashml",
    }
    models: dict[Literal["primary", "lightweight"], ModelSpec] = {
        model.class_name: model for model in manifest.models
    }
    if set(models) != set(expected_routes):
        raise ValueError("run manifest does not contain the approved model cells")
    for model_class, provider in expected_routes.items():
        route = models[model_class].routing
        if route.order != [provider] or route.allow_fallbacks:
            raise ValueError("run manifest does not use the approved fixed provider routes")
    task_by_id = {task.id: task for task in tasks}
    for trial in selected_trials:
        if trial.model_class not in models or trial.transport not in manifest.transports:
            raise ValueError("selection contains an unregistered model or transport")
        task = task_by_id.get(trial.task_id)
        if task is None or trial.transport not in task.fixture.transports:
            raise ValueError("selection contains a task outside its registered transport scope")
        if trial.repeat_index > manifest.repeats:
            raise ValueError("selection contains a repeat outside the registered run plan")


def _validate_parents(
    parents: dict[ParentName, ParentArtifact],
    *,
    selection_directory: Path,
) -> dict[str, dict[str, str]]:
    metadata: dict[str, dict[str, str]] = {}
    for name in ("recovery_baseline", "recovery_candidate", "original_baseline", "original_candidate"):
        parent = parents[name]
        try:
            parent_path = Path(parent.path).expanduser()
            if not parent_path.is_absolute():
                parent_path = selection_directory / parent_path
            parent_path = parent_path.resolve(strict=True)
            raw = parent_path.read_bytes()
        except (OSError, RuntimeError) as exc:
            raise ValueError(f"{name} parent artifact is unavailable") from exc
        if hashlib.sha256(raw).hexdigest() != parent.sha256:
            raise ValueError(f"{name} parent artifact SHA-256 does not match the selection")
        try:
            artifact = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError(f"{name} parent artifact is invalid JSON") from exc
        expected_arm = "baseline" if name.endswith("_baseline") else "candidate"
        if not isinstance(artifact, dict) or artifact.get("arm") != expected_arm:
            raise ValueError(f"{name} parent artifact has the wrong arm identity")
        metadata[name] = {"path": str(parent_path), "sha256": parent.sha256}
    return metadata


def _parent_results(
    parents: dict[str, dict[str, str]],
    selected_trials: list[SelectedTrial],
) -> dict[SelectionIdentity, dict[str, dict[str, Any]]]:
    artifacts: dict[str, dict[str, Any]] = {}
    for name, parent in parents.items():
        raw = Path(parent["path"]).read_bytes()
        if hashlib.sha256(raw).hexdigest() != parent["sha256"]:
            raise ValueError(f"{name} parent artifact changed while selection was loading")
        parsed = json.loads(raw)
        artifacts[name] = parsed

    results: dict[SelectionIdentity, dict[str, dict[str, Any]]] = {}
    for trial in selected_trials:
        lineage = trial.parent_lineage
        rows_by_arm: dict[str, dict[str, Any]] = {}
        for arm in ("baseline", "candidate"):
            name = f"{lineage}_{arm}"
            artifact = artifacts[name]
            rows = [
                row
                for run in artifact.get("runs", {}).values()
                if isinstance(run, dict)
                for row in run.get("trials", [])
                if isinstance(row, dict)
                and all(
                    row.get(field) == value
                    for field, value in zip(
                        ("model_class", "transport", "task_id", "repeat_index"),
                        trial.identity,
                        strict=True,
                    )
                )
            ]
            if len(rows) != 1 or rows[0].get("arm") != arm:
                raise ValueError(f"{name} does not contain exactly one registered parent trial")
            rows_by_arm[arm] = rows[0]
        baseline, candidate = rows_by_arm["baseline"], rows_by_arm["candidate"]
        if trial.role == "failure":
            if candidate.get("success") is not False or candidate.get("failure_kind") != "tool":
                raise ValueError("selected failure is not a prior candidate tool failure")
        elif baseline.get("success") is not True or candidate.get("success") is not True:
            raise ValueError("selected control was not successful in both pinned parent arms")
        if (
            trial.prior_candidate_failure_kind is not None
            and candidate.get("failure_kind") != trial.prior_candidate_failure_kind
        ):
            raise ValueError("selected prior candidate failure metadata differs from its pinned parent row")
        if trial.prior_both_arms_success is not None and trial.prior_both_arms_success != (
            baseline.get("success") is True and candidate.get("success") is True
        ):
            raise ValueError("selected prior control metadata differs from its pinned parent rows")
        results[trial.identity] = rows_by_arm
    return results


def _parent_metrics(row: dict[str, Any]) -> dict[str, Any]:
    fields = (
        "success",
        "trial_error",
        "failure_kind",
        "first_action_accuracy",
        "first_material_action_accuracy",
        "argument_validity",
        "nonexistent_tool_attempts",
        "wrong_capability_calls",
        "model_requests",
        "input_tokens",
        "output_tokens",
        "cost_usd",
    )
    return {field: row.get(field) for field in fields}


def _trial_metrics(outcome: TrialOutcome, expected_instructions: str | None) -> dict[str, Any]:
    return {
        "success": outcome.success,
        "trial_error": outcome.trial_error,
        "failure_kind": outcome.failure_kind,
        "first_action_accuracy": outcome.first_action_accuracy,
        "first_material_action_accuracy": outcome.first_material_action_accuracy,
        "argument_validity": outcome.argument_validity,
        "nonexistent_tool_attempts": outcome.nonexistent_tool_attempts,
        "wrong_capability_calls": outcome.wrong_capability_calls,
        "model_requests": outcome.model_requests,
        "input_tokens": outcome.input_tokens,
        "output_tokens": outcome.output_tokens,
        "cost_usd": outcome.cost_usd,
        "server_instructions_sha256": outcome.server_instructions_sha256,
        "model_input_requests": len(outcome.model_input_evidence),
        "server_instructions_delivered": has_server_instructions_evidence(outcome, expected_instructions),
    }


def build_selection_summary(
    selection: ToolGuidanceSelection,
    artifacts: dict[str, dict[str, Any]],
    comparison: dict[str, Any],
    *,
    manifest: BenchmarkRunManifest,
    tasks: list[TaskManifest],
) -> dict[str, Any]:
    expected = selection.identities
    expected_smoke_cells = [
        f"{model.class_name}:{transport}"
        for model in manifest.models
        for transport in manifest.transports
    ]
    arm_summaries: dict[str, Any] = {}
    observed: dict[str, set[SelectionIdentity]] = {}
    outcome_by_arm: dict[str, dict[SelectionIdentity, TrialOutcome]] = {}
    complete = comparison.get("verdict") == "inconclusive"
    smoke_requests = 0
    event_lists: list[list[dict[str, Any]]] = []
    paired_complete = True
    task_by_id = {task.id: task for task in tasks}
    model_ids: dict[str, str] = {model.class_name: model.model_id for model in manifest.models}

    for arm in ("baseline", "candidate"):
        artifact = artifacts.get(arm, {})
        complete = complete and artifact.get("selection") == selection.artifact_metadata()
        rows: dict[SelectionIdentity, TrialOutcome] = {}
        counts: Counter[SelectionIdentity] = Counter()
        all_ids: set[SelectionIdentity] = set()
        malformed = 0
        runs = artifact.get("runs", {})
        for run in runs.values() if isinstance(runs, dict) else []:
            for raw in run.get("trials", []) if isinstance(run, dict) else []:
                if not isinstance(raw, dict):
                    malformed += 1
                    continue
                identity_value = (
                    raw.get("model_class"),
                    raw.get("transport"),
                    raw.get("task_id"),
                    raw.get("repeat_index"),
                )
                if not (
                    isinstance(identity_value[0], str)
                    and isinstance(identity_value[1], str)
                    and isinstance(identity_value[2], str)
                    and isinstance(identity_value[3], int)
                ):
                    malformed += 1
                    continue
                identity = (identity_value[0], identity_value[1], identity_value[2], identity_value[3])
                all_ids.add(identity)
                counts[identity] += 1
                try:
                    outcome = TrialOutcome.model_validate(raw)
                except ValueError:
                    malformed += 1
                    continue
                if outcome.arm != arm:
                    malformed += 1
                    continue
                if outcome.model_id != model_ids.get(outcome.model_class):
                    malformed += 1
                    continue
                rows[identity] = outcome
        outcome_by_arm[arm] = rows
        observed[arm] = all_ids & expected
        missing = sorted(expected - observed[arm])
        duplicates = sorted(identity for identity in expected if counts[identity] > 1)
        extras = sorted(all_ids - expected)
        measured = sum(
            has_measured_evidence(outcome, task_by_id[outcome.task_id])
            for outcome in rows.values()
            if outcome.task_id in task_by_id
        )
        proof_missing = [
            identity
            for identity, outcome in rows.items()
            if not _instruction_proof_valid(outcome, artifact, task_by_id)
        ]
        arm_complete = (
            not missing
            and not duplicates
            and not extras
            and malformed == 0
            and measured == len(expected)
            and not proof_missing
        )
        complete = complete and arm_complete

        smoke_gate = artifact.get("smoke_gate", {})
        smoke = smoke_gate.get("cells", []) if isinstance(smoke_gate, dict) else []
        smoke_cells = [cell.get("cell") for cell in smoke if isinstance(cell, dict)]
        smoke_valid = (
            isinstance(smoke_gate, dict)
            and smoke_gate.get("status") == "passed"
            and smoke_gate.get("required_cells") == expected_smoke_cells
            and smoke_cells == expected_smoke_cells
        )
        for cell in smoke if isinstance(smoke, list) else []:
            raw_outcome = cell.get("outcome") if isinstance(cell, dict) else None
            if not isinstance(raw_outcome, dict):
                smoke_valid = False
                continue
            try:
                smoke_outcome = TrialOutcome.model_validate(raw_outcome)
            except ValueError:
                smoke_valid = False
                continue
            smoke_requests += smoke_outcome.model_requests
            smoke_valid = (
                smoke_valid
                and cell.get("status") == "completed"
                and _instruction_proof_valid(smoke_outcome, artifact, task_by_id)
            )
        complete = complete and smoke_valid

        execution = artifact.get("paired_execution", {})
        if isinstance(execution, dict):
            events = execution.get("events", [])
            if isinstance(events, list) and all(isinstance(event, dict) for event in events):
                event_lists.append(events)
            else:
                paired_complete = False
            paired_complete = paired_complete and execution.get("complete") is True
        else:
            paired_complete = False
        arm_summaries[arm] = {
            "artifact_status": artifact.get("status"),
            "observed_selected_trials": len(rows),
            "expected_selected_trials": len(expected),
            "missing_identities": [list(item) for item in missing],
            "duplicate_identities": [list(item) for item in duplicates],
            "unexpected_identities": [list(item) for item in extras],
            "malformed_trials": malformed,
            "missing_instruction_proof": [list(item) for item in proof_missing],
            "unselected_model_requests": sum(
                outcome.model_requests for identity, outcome in rows.items() if identity not in expected
            ),
            "smoke_gate_status": smoke_gate.get("status") if isinstance(smoke_gate, dict) else None,
        }

    expected_events = {
        (f"{model_class}:{transport}", task_id, repeat, arm)
        for model_class, transport, task_id, repeat in expected
        for arm in ("baseline", "candidate")
    }
    event_count = 0
    if len(event_lists) == 2 and event_lists[0] == event_lists[1]:
        events = event_lists[0]
        event_count = len(events)
        keys = {
            (event.get("cell"), event.get("task_id"), event.get("repeat_index"), event.get("arm"))
            for event in events
            if type(event.get("sequence")) is int
        }
        try:
            order_valid = all(
                type(event["repeat_index"]) is int
                and type(event["order_position"]) is int
                and event["order_position"]
                == planned_arm_order(
                    event["task_id"],
                    event["repeat_index"],
                    manifest.paired_order_seed,
                ).index(event["arm"])
                for event in events
            )
        except (KeyError, TypeError, ValueError):
            order_valid = False
        complete = complete and (
            paired_complete
            and len(events) == 2 * len(expected)
            and [event.get("sequence") for event in events] == list(range(1, len(events) + 1))
            and keys == expected_events
            and order_valid
        )
    else:
        complete = False

    comparisons: list[dict[str, Any]] = []
    for trial in selection.selected_trials:
        identity = trial.identity
        previous = selection.parent_results[identity]
        new_baseline = outcome_by_arm.get("baseline", {}).get(identity)
        new_candidate = outcome_by_arm.get("candidate", {}).get(identity)
        comparisons.append(
            {
                "identity": list(identity),
                "role": trial.role,
                "parent_lineage": trial.parent_lineage,
                "prior_baseline": _parent_metrics(previous["baseline"]),
                "prior_candidate": _parent_metrics(previous["candidate"]),
                "new_baseline": (
                    _trial_metrics(
                        new_baseline,
                        _sealed_instructions(artifacts.get("baseline", {}), new_baseline, task_by_id),
                    )
                    if new_baseline is not None
                    else None
                ),
                "new_candidate": (
                    _trial_metrics(
                        new_candidate,
                        _sealed_instructions(artifacts.get("candidate", {}), new_candidate, task_by_id),
                    )
                    if new_candidate is not None
                    else None
                ),
            }
        )
    total_trial_cost = sum(
        (Decimal(str(outcome.cost_usd)) for outcomes in outcome_by_arm.values() for outcome in outcomes.values()),
        start=Decimal("0"),
    )
    return {
        "schema_version": 1,
        "work_item": WORK_ITEM,
        "selection": selection.artifact_metadata(),
        "status": "complete" if complete else "incomplete",
        "canonical_comparison_verdict": comparison.get("verdict", "inconclusive"),
        "adopt_eligible": False,
        "parent_results_merged": False,
        "arms": arm_summaries,
        "identity_comparisons": comparisons,
        "expected_paired_identities": len(expected),
        "expected_new_model_trials": 2 * len(expected),
        "observed_paired_execution_events": event_count,
        "paired_execution_complete": paired_complete,
        "smoke_cells_per_arm": len(expected_smoke_cells),
        "observed_new_smoke_model_requests": smoke_requests,
        "new_selected_trial_cost_usd": str(total_trial_cost),
        "new_execution_cost_limit_usd": str(NEW_EXECUTION_LIMIT_USD),
        "unselected_model_requests": sum(
            summary["unselected_model_requests"] for summary in arm_summaries.values()
        ),
    }


def _sealed_instructions(
    artifact: dict[str, Any],
    outcome: TrialOutcome,
    task_by_id: dict[str, TaskManifest],
) -> str | None:
    task = task_by_id.get(outcome.task_id)
    catalogs = artifact.get("catalogs")
    if task is None or not isinstance(catalogs, dict):
        return None
    snapshot = catalogs.get(f"{outcome.transport}:{task.fixture.credential_profile}")
    discovery = snapshot.get("server_discover") if isinstance(snapshot, dict) else None
    instructions = discovery.get("instructions") if isinstance(discovery, dict) else None
    return instructions if isinstance(instructions, str) else None


def _instruction_proof_valid(
    outcome: TrialOutcome,
    artifact: dict[str, Any],
    task_by_id: dict[str, TaskManifest],
) -> bool:
    return has_server_instructions_evidence(
        outcome,
        _sealed_instructions(artifact, outcome, task_by_id),
    )
