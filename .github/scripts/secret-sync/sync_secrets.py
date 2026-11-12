#!/usr/bin/env python3
"""Sync one secrets.enc.yaml to its resolved Azure Key Vault, one block at a time.

The committed file is a plain YAML map of independently encrypted per-value SOPS
blobs, deliberately *not* a native multi-key SOPS document::

    API_TOKEN: |
      {"value":"ENC[...]","sops":{"azure_kv":[...],"mac":"ENC[...]"}}

Secret names stay readable so the portal can list them. Therefore this script:

* parses the outer YAML with PyYAML ``safe_load`` -- never grep/sed;
* never runs ``sops --decrypt`` over the outer map;
* decrypts exactly one block at a time into a 0600 file inside a 0700 directory;
* writes the extracted ``value`` to a second 0600 file and hands only that path
  to ``az keyvault secret set --file``, so the plaintext never appears in an
  argument vector, an environment variable, or the process list;
* removes both temporary files on success and on failure, including on signals;
* never re-encrypts or rewrites sibling blocks.

Logging is restricted to non-secret diagnostics: file path, vault name, vault
resource ID, secret name, commit SHA and run ID. Subprocess output is never
echoed verbatim, because SOPS and az can quote input data in error messages.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from types import FrameType
from typing import Any

import yaml

# Azure Key Vault secret names: alphanumerics and dashes, 1-127 characters.
SECRET_NAME_RE = re.compile(r"^[0-9a-zA-Z-]{1,127}$")

# Anything that looks like it could carry secret material is dropped from logs.
_MAX_ERROR_CHARS = 400


class SyncError(Exception):
    """A failure that must abort the sync without leaking secret material."""


# --------------------------------------------------------------------------- #
# Logging that cannot leak plaintext
# --------------------------------------------------------------------------- #


def log(message: str) -> None:
    print(message, flush=True)


def _safe_error(tool: str, stderr: str) -> str:
    """Summarise a subprocess failure without echoing data it may have quoted.

    SOPS and the Azure CLI both include fragments of their input in some error
    messages, so only a allow-listed, truncated summary is surfaced.
    """
    collapsed = " ".join(stderr.split())
    if not collapsed:
        return f"{tool} failed with no diagnostic output"
    # Keep only lines that look like tool diagnostics, not data.
    redacted = re.sub(r"ENC\[[^\]]*\]", "ENC[...]", collapsed)
    if len(redacted) > _MAX_ERROR_CHARS:
        redacted = redacted[:_MAX_ERROR_CHARS] + " ...(truncated)"
    return f"{tool} failed: {redacted}"


# --------------------------------------------------------------------------- #
# Temporary workspace
# --------------------------------------------------------------------------- #


class SecureWorkspace:
    """A 0700 directory whose contents are removed on exit or on a signal."""

    def __init__(self) -> None:
        self._path: str | None = None
        self._previous_handlers: dict[int, Any] = {}

    def __enter__(self) -> "SecureWorkspace":
        self._path = tempfile.mkdtemp(prefix="secret-sync-")
        os.chmod(self._path, 0o700)
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            try:
                self._previous_handlers[sig] = signal.signal(sig, self._on_signal)
            except (ValueError, OSError):  # not available on this platform/thread
                continue
        return self

    def __exit__(self, *_exc: object) -> None:
        self.cleanup()
        for sig, handler in self._previous_handlers.items():
            try:
                signal.signal(sig, handler)
            except (ValueError, OSError):
                continue

    def _on_signal(self, signum: int, _frame: FrameType | None) -> None:
        self.cleanup()
        # Re-raise with the default disposition so the exit status is honest.
        signal.signal(signum, signal.SIG_DFL)
        os.kill(os.getpid(), signum)

    @property
    def path(self) -> str:
        if self._path is None:
            raise SyncError("workspace used outside its context manager")
        return self._path

    def write_private(self, name: str, content: str) -> str:
        """Create a 0600 file; the mode is set before any content is written."""
        target = os.path.join(self.path, name)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
        handle = os.open(target, flags, 0o600)
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                stream.write(content)
        except BaseException:
            _shred(target)
            raise
        return target

    def cleanup(self) -> None:
        if self._path is None:
            return
        path, self._path = self._path, None
        for root, _dirs, files in os.walk(path):
            for name in files:
                _shred(os.path.join(root, name))
        shutil.rmtree(path, ignore_errors=True)


def _shred(path: str) -> None:
    """Best-effort overwrite before unlinking, then always unlink."""
    try:
        size = os.path.getsize(path)
        with open(path, "r+b") as handle:
            handle.write(b"\0" * size)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError:
        pass
    try:
        os.unlink(path)
    except OSError:
        pass


# --------------------------------------------------------------------------- #
# Encrypted file parsing
# --------------------------------------------------------------------------- #


def parse_secret_blocks(secrets_path: str) -> list[tuple[str, str]]:
    """Return [(secret_name, sops_blob_json)] from the outer YAML map."""
    try:
        with open(secrets_path, "r", encoding="utf-8") as handle:
            document = yaml.safe_load(handle)
    except OSError as exc:
        raise SyncError(f"cannot read {secrets_path}: {exc}") from exc
    except yaml.YAMLError as exc:
        # A YAML parse error can quote the offending line; report position only.
        mark = getattr(exc, "problem_mark", None)
        where = f" at line {mark.line + 1}" if mark else ""
        raise SyncError(f"{secrets_path} is not valid YAML{where}") from None

    if document is None:
        return []
    if not isinstance(document, dict):
        raise SyncError(
            f"{secrets_path} must be a YAML map of secret name -> SOPS blob"
        )

    blocks: list[tuple[str, str]] = []
    for name, value in document.items():
        if not isinstance(name, str) or not SECRET_NAME_RE.match(name):
            # Azure Key Vault permits only alphanumerics and dashes. Underscores
            # are the common trip-up (API_TOKEN vs API-TOKEN). Fail closed with
            # an actionable message rather than letting `az` reject it later, and
            # never rename the secret silently: the portal lists the name from
            # this file, so it must match what lands in Azure.
            hint = ""
            if isinstance(name, str) and "_" in name:
                suggestion = name.replace("_", "-")
                hint = f"; underscores are not allowed - use '{suggestion}'"
            raise SyncError(
                "secret name is not a valid Azure Key Vault secret name "
                f"(alphanumerics and dashes, 1-127 chars){hint}"
            )
        if not isinstance(value, str):
            raise SyncError(
                f"block '{name}' must be a string containing one JSON SOPS blob"
            )
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            raise SyncError(
                f"block '{name}' is not a JSON SOPS blob; the outer file must "
                "hold one independently encrypted blob per secret"
            ) from None
        if not isinstance(parsed, dict) or "sops" not in parsed:
            raise SyncError(f"block '{name}' is not SOPS-encrypted")
        if "value" not in parsed:
            raise SyncError(f"block '{name}' has no 'value' field")
        blocks.append((name, value))
    return blocks


# --------------------------------------------------------------------------- #
# Decrypt + write
# --------------------------------------------------------------------------- #


def _run(argv: list[str], tool: str) -> str:
    """Run a command, capturing output so nothing is echoed to the job log."""
    try:
        completed = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        raise SyncError(f"{tool} could not be executed: {exc}") from exc
    if completed.returncode != 0:
        raise SyncError(_safe_error(tool, completed.stderr))
    return completed.stdout


def decrypt_block(workspace: SecureWorkspace, name: str, blob: str) -> str:
    """Decrypt one block and return the path of a 0600 file holding its value."""
    blob_path = workspace.write_private(f"{name}.blob.json", blob)
    try:
        plaintext_json = _run(
            [
                "sops",
                "--decrypt",
                "--input-type",
                "json",
                "--output-type",
                "json",
                blob_path,
            ],
            "sops --decrypt",
        )
    finally:
        _shred(blob_path)

    try:
        decrypted = json.loads(plaintext_json)
    except json.JSONDecodeError:
        raise SyncError(f"decrypted block '{name}' is not JSON") from None
    if not isinstance(decrypted, dict) or "value" not in decrypted:
        raise SyncError(f"decrypted block '{name}' has no 'value' field")
    value = decrypted["value"]
    if not isinstance(value, str):
        raise SyncError(f"decrypted block '{name}' has a non-string 'value'")

    # Hand az a file, never an argument: argv is world-readable via /proc.
    return workspace.write_private(f"{name}.value", value)


def set_secret(vault_name: str, name: str, value_path: str) -> None:
    _run(
        [
            "az",
            "keyvault",
            "secret",
            "set",
            "--vault-name",
            vault_name,
            "--name",
            name,
            "--file",
            value_path,
            "--output",
            "none",
        ],
        "az keyvault secret set",
    )


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def sync_file(
    secrets_path: str,
    vault_name: str,
    vault_resource_id: str,
    commit_sha: str,
    run_id: str,
) -> int:
    blocks = parse_secret_blocks(secrets_path)
    log(f"file={secrets_path}")
    log(f"vault={vault_name}")
    log(f"vaultResourceId={vault_resource_id}")
    log(f"commit={commit_sha} runId={run_id}")
    log(f"secretCount={len(blocks)}")

    if not blocks:
        log("no secret blocks present; nothing to sync")
        return 0

    failures = 0
    with SecureWorkspace() as workspace:
        for name, blob in blocks:
            value_path = None
            try:
                value_path = decrypt_block(workspace, name, blob)
                set_secret(vault_name, name, value_path)
                log(f"synced secret={name} -> {vault_name}")
            except SyncError as exc:
                failures += 1
                log(f"::error::secret={name}: {exc}")
            finally:
                if value_path:
                    _shred(value_path)
    if failures:
        log(f"::error::{failures} of {len(blocks)} secret(s) failed to sync")
    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync one secrets.enc.yaml file.")
    parser.add_argument("--secrets-file", required=True)
    parser.add_argument("--vault-name", required=True)
    parser.add_argument("--vault-resource-id", default="")
    parser.add_argument("--commit-sha", default=os.environ.get("GITHUB_SHA", ""))
    parser.add_argument("--run-id", default=os.environ.get("GITHUB_RUN_ID", ""))
    args = parser.parse_args(argv)

    try:
        return sync_file(
            args.secrets_file,
            args.vault_name,
            args.vault_resource_id,
            args.commit_sha,
            args.run_id,
        )
    except SyncError as exc:
        log(f"::error::{exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
