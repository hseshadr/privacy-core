"""Privacy Core's complete quality, security, and release-candidate graph."""

from __future__ import annotations

from typing import Final, Self

import dagger
from dagger import check, dag, field, function, object_type

NODE_IMAGE: Final = (
    "node:24.16.0-bookworm-slim@sha256:"
    "2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203"
)
ACTIONLINT_IMAGE: Final = (
    "rhysd/actionlint:1.7.10@sha256:"
    "ef8299f97635c4c30e2298f48f30763ab782a4ad2c95b744649439a039421e36"
)
GITLEAKS_IMAGE: Final = (
    "ghcr.io/gitleaks/gitleaks:v8.29.1@sha256:"
    "aa036a2f4bdfe3cc3c55fa4326308efabb4a6be498c883c864fd1d0d5585438a"
)
REPOSITORY: Final = "hseshadr/privacy-core"
REPOSITORY_URL: Final = f"https://github.com/{REPOSITORY}.git"
PNPM_VERSION: Final = "11.5.0"
SHA_LENGTH: Final = 40
SOURCE_EXCLUDES: Final = [
    ".git",
    ".dagger/.venv",
    ".dagger/sdk",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "**/__pycache__",
    "node_modules",
    "**/node_modules",
    "coverage",
    "dist",
    "playwright-report",
    "test-results",
]
INSTALL_COMMAND: Final = ["pnpm", "install", "--frozen-lockfile"]
PLAYWRIGHT_INSTALL: Final = [
    "pnpm",
    "exec",
    "playwright",
    "install",
    "--with-deps",
    "chromium",
]
GITLEAKS_SNAPSHOT: Final = [
    "gitleaks",
    "detect",
    "--source",
    "/snapshot",
    "--no-git",
    "--redact",
    "--no-banner",
]
GITLEAKS_HISTORY: Final = [
    "gitleaks",
    "detect",
    "--source",
    "/repo",
    "--log-opts=--all",
    "--redact",
    "--no-banner",
]


@object_type
class PrivacyCore:
    """Run the same typed Privacy Core release graph locally and on GitHub."""

    source: dagger.Directory = field()

    @classmethod
    def create(cls, workspace: dagger.Workspace) -> Self:
        """Construct the graph from an explicit typed workspace snapshot."""
        instance = cls.__new__(cls)
        instance.source = workspace.directory("/", exclude=SOURCE_EXCLUDES)
        return instance

    @function
    def quality(self) -> dagger.Container:
        """Run lint, strict typing, coverage, browser proof, and build."""
        return self._quality(self.source)

    def _quality(self, source: dagger.Directory) -> dagger.Container:
        return self._playwright(source).with_exec(["pnpm", "gate"])

    @function
    def offline(self) -> dagger.Container:
        """Run the real Chromium offline and egress-boundary proof."""
        return self._playwright(self.source).with_exec(["pnpm", "test:e2e"])

    @function
    def dependency_audit(self) -> dagger.Container:
        """Audit the exact frozen pnpm graph without suppressions."""
        return self._dependency_audit(self.source)

    def _dependency_audit(self, source: dagger.Directory) -> dagger.Container:
        command = ["pnpm", "audit", "--audit-level", "moderate"]
        return self._dependencies(source).with_exec(command)

    @function
    def secret_scan(self, commit_sha: str = "") -> dagger.Container:
        """Scan the typed snapshot and complete canonical history."""
        return self._secret_scan(self.source, commit_sha)

    def _secret_scan(self, source: dagger.Directory, commit_sha: str = "") -> dagger.Container:
        history = self._history(commit_sha)
        scan = self._gitleaks().with_directory("/snapshot", source)
        scan = scan.with_exec(["sh", "-ceu", self._nonempty_snapshot()])
        scan = scan.with_exec(GITLEAKS_SNAPSHOT).with_directory("/repo", history)
        return scan.with_exec(GITLEAKS_HISTORY)

    @function
    def workflow_security(self) -> dagger.Container:
        """Validate every GitHub ingress workflow with pinned actionlint."""
        return self._workflow_security(self.source)

    def _workflow_security(self, source: dagger.Directory) -> dagger.Container:
        workflows = source.directory(".github/workflows")
        command = (
            "find .github/workflows -type f "
            "\\( -name '*.yml' -o -name '*.yaml' \\) -exec actionlint {} +"
        )
        return (
            self._actionlint()
            .with_directory("/repo/.github/workflows", workflows)
            .with_exec(["sh", "-ceu", command])
        )

    @function
    @check
    async def ci(self, commit_sha: str = "") -> str:
        """Run the canonical gate sequentially to bound runner memory."""
        await self._run_ci(self.source, commit_sha)
        return "Privacy Core canonical Dagger gate passed"

    async def _run_ci(self, source: dagger.Directory, commit_sha: str = "") -> None:
        await self._quality(source).sync()
        await self._dependency_audit(source).sync()
        await self._secret_scan(source, commit_sha).sync()
        await self._workflow_security(source).sync()

    @function
    async def release_candidate(
        self, tag: str, commit_sha: str, github_token: dagger.Secret
    ) -> dagger.Directory:
        """Build one exact Dagger-proven npm candidate without publishing."""
        self._require_sha(commit_sha)
        await self._hosted(commit_sha, tag, github_token).sync()
        source = self._release_source(commit_sha)
        await self._identity(source, tag).sync()
        await self._run_ci(source, commit_sha)
        return self._candidate(source, tag).directory("/candidate")

    def _hosted(self, commit_sha: str, tag: str, token: dagger.Secret) -> dagger.Container:
        command = self._contract_command("github", tag, commit_sha)
        return (
            self._node(self.source).with_secret_variable("GITHUB_TOKEN", token).with_exec(command)
        )

    def _identity(self, source: dagger.Directory, tag: str) -> dagger.Container:
        command = [
            "node",
            "scripts/release-contract.ts",
            "identity",
            "--root",
            ".",
            "--tag",
            tag,
        ]
        return self._node(source).with_exec(command)

    def _candidate(self, source: dagger.Directory, tag: str) -> dagger.Container:
        version = tag.removeprefix("v")
        archive = f"/candidate/edgeproc-privacy-core-{version}.tgz"
        built = self._dependencies(source).with_exec(["pnpm", "build"])
        built = built.with_exec(["mkdir", "-p", "/candidate"]).with_exec(
            ["npm", "pack", "--ignore-scripts", "--pack-destination", "/candidate"]
        )
        built = built.with_exec(self._artifact_command(archive, tag))
        return built.with_exec(self._checksum_command(archive))

    @staticmethod
    def _artifact_command(archive: str, tag: str) -> list[str]:
        return [
            "node",
            "scripts/release-contract.ts",
            "artifact",
            "--root",
            ".",
            "--archive",
            archive,
            "--tag",
            tag,
        ]

    @staticmethod
    def _checksum_command(archive: str) -> list[str]:
        return [
            "node",
            "scripts/release-contract.ts",
            "checksum",
            "--archive",
            archive,
            "--output",
            "/candidate/SHA256SUMS",
        ]

    @staticmethod
    def _contract_command(command: str, tag: str, commit_sha: str) -> list[str]:
        return [
            "node",
            "scripts/release-contract.ts",
            command,
            "--repository",
            REPOSITORY,
            "--sha",
            commit_sha,
            "--tag",
            tag,
        ]

    def _playwright(self, source: dagger.Directory) -> dagger.Container:
        installed = self._dependencies(source).with_user("0:0")
        installed = installed.with_exec(PLAYWRIGHT_INSTALL)
        return installed.with_exec(["chown", "-R", "65532:65532", "/opt/playwright"]).with_user(
            "65532:65532"
        )

    def _dependencies(self, source: dagger.Directory) -> dagger.Container:
        return (
            self._node(source)
            .with_exec(["pnpm", "config", "set", "store-dir", "/opt/pnpm-store"])
            .with_exec(INSTALL_COMMAND)
        )

    def _node(self, source: dagger.Directory) -> dagger.Container:
        base = (
            self._node_toolchain()
            .with_directory("/src", source, owner="65532:65532")
            .with_workdir("/src")
        )
        base = base.with_env_variable("HOME", "/opt/home")
        base = base.with_env_variable("PLAYWRIGHT_BROWSERS_PATH", "/opt/playwright")
        base = base.with_mounted_cache(
            "/opt/pnpm-store", dag.cache_volume("privacy-core-pnpm"), owner="65532:65532"
        )
        base = base.with_exec(["mkdir", "-p", "/opt/home", "/opt/playwright"])
        base = base.with_exec(["chown", "-R", "65532:65532", "/opt/home", "/opt/playwright"])
        return base.with_user("65532:65532")

    @staticmethod
    def _node_toolchain() -> dagger.Container:
        base = dag.container().from_(NODE_IMAGE).with_exec(["corepack", "enable", "pnpm"])
        return base.with_exec(["corepack", "install", "--global", f"pnpm@{PNPM_VERSION}"])

    @staticmethod
    def _history(commit_sha: str) -> dagger.Directory:
        if commit_sha:
            PrivacyCore._require_sha(commit_sha)
            return PrivacyCore._release_source(commit_sha)
        return dag.git(REPOSITORY_URL).branch("main").tree(depth=0, include_tags=True)

    @staticmethod
    def _release_source(commit_sha: str) -> dagger.Directory:
        return dag.git(REPOSITORY_URL).commit(commit_sha).tree(depth=0, include_tags=True)

    @staticmethod
    def _actionlint() -> dagger.Container:
        return dag.container().from_(ACTIONLINT_IMAGE).with_entrypoint([]).with_workdir("/repo")

    @staticmethod
    def _gitleaks() -> dagger.Container:
        return dag.container().from_(GITLEAKS_IMAGE).with_entrypoint([])

    @staticmethod
    def _nonempty_snapshot() -> str:
        return 'test -n "$(find /snapshot -type f -print -quit)"'

    @staticmethod
    def _require_sha(commit_sha: str) -> None:
        valid_length = len(commit_sha) == SHA_LENGTH
        valid = valid_length and all(char in "0123456789abcdef" for char in commit_sha)
        if not valid:
            raise ValueError("commit_sha must be a lowercase 40-character Git SHA")
