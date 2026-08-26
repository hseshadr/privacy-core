"""Behavioral contracts for Privacy Core's typed Dagger release graph."""

from __future__ import annotations

import inspect
from typing import cast

import dagger

from privacy_core.main import PrivacyCore


class RecordingWorkspace:
    """Record the explicit source root selected by the constructor."""

    def __init__(self) -> None:
        self.path = ""
        self.excludes: list[str] = []

    def directory(self, path: str, *, exclude: list[str]) -> dagger.Directory:
        self.path = path
        self.excludes = exclude
        return cast(dagger.Directory, object())


def test_should_select_an_explicit_typed_workspace_root() -> None:
    workspace = RecordingWorkspace()

    PrivacyCore.create(cast(dagger.Workspace, workspace))

    assert workspace.path == "/"
    assert ".git" in workspace.excludes
    assert "node_modules" in workspace.excludes


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
