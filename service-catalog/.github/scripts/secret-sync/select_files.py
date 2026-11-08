#!/usr/bin/env python3
"""Select and validate which secrets.enc.yaml files a sync run may process.

This runs *before* Azure login and before any SOPS install, so it deliberately
uses only the standard library: an invalid path must be rejected before the job
holds any Azure credential.

Two modes:

``--mode dispatch``
    Process exactly the one ``--file-path`` the operator requested. A manual run
    never expands to "every encrypted file"; a missing or invalid path fails.

``--mode push``
    Derive changed files from ``--before``..``--sha`` on the default branch and
    re-check every one against the same allow-list.

Any candidate that fails validation aborts the run rather than being skipped, so
an unexpected encrypted file cannot merge unnoticed.
"""

from __future__ import annotations

import argparse
import os
import posixpath
import re
import subprocess
import sys

SECRETS_FILENAME = "secrets.enc.yaml"

# Vault directory layouts this repository actually uses.
INFRA_VAULT_DIR_RE = re.compile(r"^infrastructure/.+/keyvault[0-9]*$")
DATABRICKS_VAULT_DIR_RE = re.compile(r"^azureDatabricks/[^/]+/keyvault$")
INFRA_ANY_DIR_RE = re.compile(r"^infrastructure/.+$")

DEFINITION_TERRAGRUNT = "terragrunt.hcl"
DEFINITION_KEYVAULT_HCL = "keyvault.hcl"

ACCEPTED_ROOTS = ("infrastructure", "azureDatabricks")


class InvalidPath(Exception):
    pass


def validate(path: str, repo_root: str) -> str:
    """Return the normalised repo-relative path, or raise InvalidPath."""
    if not path or path.strip() != path:
        raise InvalidPath("path is empty or has surrounding whitespace")
    if path.startswith("/") or "\\" in path:
        raise InvalidPath(f"path must be repo-relative with forward slashes: {path}")

    segments = path.split("/")
    if any(seg in ("", ".", "..") for seg in segments):
        raise InvalidPath(f"path traversal or empty segment: {path}")

    if posixpath.basename(path) != SECRETS_FILENAME:
        raise InvalidPath(f"not a {SECRETS_FILENAME} file: {path}")

    if segments[0] not in ACCEPTED_ROOTS:
        raise InvalidPath(
            f"'{segments[0]}/' is not an accepted root "
            f"(expected {' or '.join(r + '/' for r in ACCEPTED_ROOTS)}): {path}"
        )

    vault_dir = posixpath.dirname(path)
    abs_vault_dir = os.path.join(repo_root, vault_dir)

    # Reject symlinked vault directories: they could point outside the repo.
    if os.path.islink(abs_vault_dir):
        raise InvalidPath(f"vault directory is a symlink: {vault_dir}")
    if not os.path.isdir(abs_vault_dir):
        raise InvalidPath(f"vault directory does not exist: {vault_dir}")

    abs_file = os.path.join(repo_root, path)
    if os.path.islink(abs_file):
        raise InvalidPath(f"encrypted file is a symlink: {path}")
    if not os.path.isfile(abs_file):
        raise InvalidPath(f"file does not exist in the merged tree: {path}")

    has_terragrunt = os.path.isfile(
        os.path.join(abs_vault_dir, DEFINITION_TERRAGRUNT)
    )
    has_keyvault_hcl = os.path.isfile(
        os.path.join(abs_vault_dir, DEFINITION_KEYVAULT_HCL)
    )

    if DATABRICKS_VAULT_DIR_RE.match(vault_dir):
        if not has_terragrunt:
            raise InvalidPath(
                f"{vault_dir} has no sibling {DEFINITION_TERRAGRUNT}: {path}"
            )
        return path

    if INFRA_VAULT_DIR_RE.match(vault_dir):
        if not (has_terragrunt or has_keyvault_hcl):
            raise InvalidPath(
                f"{vault_dir} has neither {DEFINITION_TERRAGRUNT} nor "
                f"{DEFINITION_KEYVAULT_HCL}: {path}"
            )
        return path

    if INFRA_ANY_DIR_RE.match(vault_dir):
        # The broad infrastructure form is only ever valid with a sibling
        # keyvault.hcl vault definition.
        if not has_keyvault_hcl:
            raise InvalidPath(
                f"{vault_dir} is not a keyvault directory and has no sibling "
                f"{DEFINITION_KEYVAULT_HCL}: {path}"
            )
        return path

    raise InvalidPath(f"path is outside every accepted vault layout: {path}")


def changed_files(repo_root: str, before: str, sha: str) -> list[str]:
    """Files added/modified between two SHAs, excluding deletions."""
    zero = "0" * 40
    if not before or before == zero:
        # First push on a new branch or a forced update with no usable base:
        # fall back to the single commit so the run stays bounded.
        argv = ["git", "show", "--pretty=", "--name-only", "--diff-filter=d", sha]
    else:
        argv = [
            "git",
            "diff",
            "--name-only",
            "--diff-filter=d",
            f"{before}..{sha}",
        ]
    result = subprocess.run(
        argv, cwd=repo_root, capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        raise SystemExit(
            f"::error::could not determine changed files: {result.stderr.strip()}"
        )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def _emit_count(count: int) -> None:
    """Emit the count as a GitHub Actions output."""
    if "GITHUB_OUTPUT" in os.environ:
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
            handle.write(f"count={count}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("dispatch", "push"), required=True)
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--file-path", default="")
    parser.add_argument("--before", default="")
    parser.add_argument("--sha", default="")
    parser.add_argument("--output", required=True, help="file to write valid paths to")
    args = parser.parse_args(argv)

    repo_root = os.path.realpath(args.repo_root)

    if args.mode == "dispatch":
        requested = args.file_path.strip()
        if not requested:
            print("::error::workflow_dispatch requires a file_path input")
            return 1
        try:
            selected = [validate(requested, repo_root)]
        except InvalidPath as exc:
            print(f"::error::rejected file_path: {exc}")
            return 1
    else:
        candidates = [
            path
            for path in changed_files(repo_root, args.before, args.sha)
            if posixpath.basename(path) == SECRETS_FILENAME
        ]
        if not candidates:
            print("no encrypted secret files changed in this push")
            with open(args.output, "w", encoding="utf-8") as handle:
                handle.write("")
            _emit_count(0)
            return 0
        selected = []
        rejected = []
        for path in candidates:
            try:
                selected.append(validate(path, repo_root))
            except InvalidPath as exc:
                rejected.append(str(exc))
        if rejected:
            # Fail the whole run: an encrypted file that does not map to a vault
            # must be visible, not silently skipped.
            for message in rejected:
                print(f"::error::rejected changed path: {message}")
            return 1

    # De-duplicate while preserving order.
    unique: list[str] = []
    for path in selected:
        if path not in unique:
            unique.append(path)

    with open(args.output, "w", encoding="utf-8") as handle:
        handle.write("\n".join(unique) + "\n")
    for path in unique:
        print(f"selected {path}")
    _emit_count(len(unique))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
