"""Behavioral contracts for Privacy Core's typed Dagger release graph."""

from __future__ import annotations

import asyncio
import inspect
import json
from pathlib import Path
from typing import cast

import dagger
import pytest

import privacy_core.main as main_module
from privacy_core.main import PrivacyCore

CENTRAL_SHA = "068c3c08c4d342b3dc2784cdc3804f2b2d51d622"
REPOSITORY = "hseshadr/privacy-core"
VALID_SHA = "a" * 40


class RecordingWorkspace:
    """Record the explicit source root selected by the constructor."""

    def __init__(self) -> None:
        self.path = ""
        self.excludes: list[str] = []

    def directory(self, path: str, *, exclude: list[str]) -> dagger.Directory:
        self.path = path
        self.excludes = exclude
        return cast(dagger.Directory, object())


class CandidateFile:
    def __init__(self, contents: str) -> None:
        self._contents = contents

    async def contents(self) -> str:
        return self._contents


class RecordingCandidate:
    def __init__(self, entries: list[str], checksum: str) -> None:
        self._entries = entries
        self._checksum = checksum

    async def entries(self) -> list[str]:
        return self._entries

    def file(self, _path: str) -> dagger.File:
        return cast(dagger.File, CandidateFile(self._checksum))


class RecordingSync:
    """Record one forced Dagger boundary and optionally reject it."""

    def __init__(self, name: str, events: list[str], error: ValueError | None = None) -> None:
        self.name = name
        self.events = events
        self.error = error

    async def sync(self) -> None:
        if self.error is not None:
            raise self.error
        self.events.append(self.name)


class RecordingFoundation:
    """Model the exact source-binding and guard boundary."""

    def __init__(self, events: list[str], error: ValueError | None = None) -> None:
        self.events = events
        self.error = error
        self.bound = cast(dagger.Directory, "bound-source")

    def source(
        self, source: dagger.Directory, repository: str, commit_sha: str
    ) -> dagger.Directory:
        assert (source, repository, commit_sha) == ("caller-source", REPOSITORY, VALID_SHA)
        self.events.append("source")
        return self.bound

    def guard(self, source: dagger.Directory, repository: str, commit_sha: str) -> dagger.Container:
        assert (source, repository, commit_sha) == (self.bound, REPOSITORY, VALID_SHA)
        return cast(dagger.Container, RecordingSync("guard", self.events, self.error))


class RecordingDag:
    """Expose only the Foundation client used by the canonical check."""

    def __init__(self, foundation: RecordingFoundation) -> None:
        self.foundation_client = foundation

    def foundation(self) -> RecordingFoundation:
        return self.foundation_client


def test_should_select_an_explicit_typed_workspace_root() -> None:
    workspace = RecordingWorkspace()

    PrivacyCore.create(cast(dagger.Workspace, workspace))

    assert workspace.path == "/"
    assert ".git" in workspace.excludes
    assert "node_modules" in workspace.excludes


def test_should_exclude_generated_python_gate_state_from_source_binding() -> None:
    # Given
    workspace = RecordingWorkspace()

    # When
    PrivacyCore.create(cast(dagger.Workspace, workspace))

    # Then
    assert {
        ".dagger/.mypy_cache",
        ".dagger/.pytest_cache",
        ".dagger/.ruff_cache",
    } <= set(workspace.excludes)


def test_should_require_typed_workspace_when_constructing_graph() -> None:
    signature = inspect.signature(PrivacyCore.create, eval_str=True)

    workspace = signature.parameters.get("workspace")

    assert workspace is not None
    assert workspace.annotation is dagger.Workspace


def test_should_expose_canonical_gate_and_release_boundaries() -> None:
    expected = {
        "ci",
        "quality",
        "dependency_audit",
        "offline",
        "publish",
        "secret_scan",
        "workflow_security",
        "release_candidate",
    }

    available = {name for name in expected if hasattr(PrivacyCore, name)}

    assert available == expected


def test_should_require_a_typed_secret_for_hosted_eligibility() -> None:
    signature = inspect.signature(PrivacyCore.release_candidate, eval_str=True)

    token = signature.parameters.get("github_token")

    assert token is not None
    assert token.annotation is dagger.Secret
    assert signature.return_annotation is dagger.Directory


def test_should_keep_the_source_free_publisher_typed_and_provenanced() -> None:
    signature = inspect.signature(PrivacyCore.publish, eval_str=True)
    implementation = inspect.getsource(PrivacyCore.publish)

    assert signature.parameters["candidate"].annotation is dagger.Directory
    assert signature.parameters["oidc_url"].annotation is dagger.Secret
    assert signature.parameters["oidc_token"].annotation is dagger.Secret
    assert "--provenance" in implementation
    assert "npm" in implementation


def test_should_accept_only_one_checksumming_npm_candidate() -> None:
    archive = "edgeproc-privacy-core-1.2.3.tgz"
    candidate = RecordingCandidate([archive, "SHA256SUMS"], f"{'a' * 64}  {archive}\n")

    result = asyncio.run(PrivacyCore._candidate_archive(cast(dagger.Directory, candidate)))

    assert result == archive


def test_should_reject_extra_or_misidentified_candidate_material() -> None:
    archive = "edgeproc-privacy-core-1.2.3.tgz"
    candidate = RecordingCandidate([archive, "SHA256SUMS", "source.ts"], f"{'a' * 64}  other.tgz\n")

    with pytest.raises(ValueError, match="candidate must contain only"):
        asyncio.run(PrivacyCore._candidate_archive(cast(dagger.Directory, candidate)))


def test_should_pin_node_and_the_repository_package_manager() -> None:
    module = inspect.getmodule(PrivacyCore)

    assert module is not None
    assert "node:24.16.0-bookworm-slim@sha256:" in module.NODE_IMAGE
    assert module.PNPM_VERSION == "11.5.0"


def test_should_scan_snapshot_history_and_both_workflow_extensions() -> None:
    secret_scan = inspect.getsource(PrivacyCore._secret_scan)
    workflow_security = inspect.getsource(PrivacyCore._workflow_security)

    assert "GITLEAKS_SNAPSHOT" in secret_scan
    assert "GITLEAKS_HISTORY" in secret_scan
    assert "*.yml" in workflow_security
    assert "*.yaml" in workflow_security


def test_should_install_frozen_dependencies_without_the_global_escape_hatch() -> None:
    implementation = inspect.getsource(PrivacyCore)
    module = inspect.getmodule(PrivacyCore)

    assert module is not None
    assert module.INSTALL_COMMAND == ["pnpm", "install", "--frozen-lockfile"]
    assert "dangerously-allow-all-builds" not in implementation
    assert '["pnpm", "gate"]' in implementation


def test_should_pin_foundation_to_the_exact_central_commit() -> None:
    # Given
    config = json.loads((Path(__file__).parents[2] / "dagger.json").read_text())

    # When
    dependencies = config.get("dependencies", [])

    # Then
    assert dependencies == [
        {
            "name": "foundation",
            "source": f"github.com/hseshadr/ci/modules/portfolio-foundation@{CENTRAL_SHA}",
            "pin": CENTRAL_SHA,
        }
    ]


def test_should_require_an_explicit_commit_for_the_canonical_check() -> None:
    # Given / When
    signature = inspect.signature(PrivacyCore.ci)

    # Then
    assert signature.parameters["commit_sha"].default is inspect.Signature.empty


def test_should_bind_guard_then_run_products_on_the_bound_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    events: list[str] = []
    foundation = RecordingFoundation(events)
    core = PrivacyCore.__new__(PrivacyCore)
    core.source = cast(dagger.Directory, "caller-source")

    async def run_products(source: dagger.Directory, *_identity: object) -> None:
        assert source == foundation.bound
        events.append("product")

    monkeypatch.setattr(main_module, "dag", RecordingDag(foundation))
    monkeypatch.setattr(core, "_run_ci", run_products)

    # When
    result = asyncio.run(core.ci(VALID_SHA))

    # Then
    assert result == "Privacy Core canonical Dagger gate passed"
    assert events == ["source", "guard", "product"]


def test_should_stop_before_products_when_foundation_rejects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    events: list[str] = []
    foundation = RecordingFoundation(events, ValueError("guard rejected"))
    core = PrivacyCore.__new__(PrivacyCore)
    core.source = cast(dagger.Directory, "caller-source")

    async def run_products(*_arguments: object) -> None:
        events.append("product")

    monkeypatch.setattr(main_module, "dag", RecordingDag(foundation))
    monkeypatch.setattr(core, "_run_ci", run_products)

    # When / Then
    with pytest.raises(ValueError, match="guard rejected"):
        asyncio.run(core.ci(VALID_SHA))
    assert events == ["source"]
