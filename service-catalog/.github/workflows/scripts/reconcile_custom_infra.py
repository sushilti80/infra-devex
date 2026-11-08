#!/usr/bin/env python3

import argparse
import json
import os
import re
import shutil
from pathlib import Path


SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]*$")
SAFE_COMMIT = re.compile(r"^[0-9a-fA-F]{7,64}$")
PROTECTED_MODULES = {"resourcegroups"}


def normalize_name(value: str, label: str) -> str:
    normalized = value.strip().lower()
    if not SAFE_NAME.fullmatch(normalized):
        raise ValueError(f"Invalid {label}: {value!r}")
    return normalized


def normalize_csv(value: str, label: str) -> list[str]:
    normalized = []
    seen = set()
    for item in value.split(","):
        if not item.strip():
            continue
        name = normalize_name(item, label)
        if name not in seen:
            normalized.append(name)
            seen.add(name)
    return normalized


def reconcile(
    repository: Path,
    project: str,
    environment: str,
    modules: str,
    source_commit: str,
    run_id: str,
    correlation_id: str,
) -> tuple[list[str], Path | None]:
    project = normalize_name(project, "project")
    environment = normalize_name(environment, "environment")
    desired = set(normalize_csv(modules, "module")) | PROTECTED_MODULES

    if not SAFE_COMMIT.fullmatch(source_commit):
        raise ValueError(f"Invalid source commit: {source_commit!r}")
    if not run_id.isdigit():
        raise ValueError(f"Invalid run ID: {run_id!r}")
    if "\n" in correlation_id or "\r" in correlation_id or len(correlation_id) > 200:
        raise ValueError("Invalid correlation ID")

    environment_dir = repository / "infrastructure" / project / environment
    existing = {
        child.name.lower(): child
        for child in environment_dir.iterdir()
        if child.is_dir() and (child / "terragrunt.hcl").is_file()
    }
    removed = sorted(existing.keys() - desired - PROTECTED_MODULES)

    for module in removed:
        shutil.rmtree(existing[module])

    request_path = None
    if removed:
        request_path = environment_dir / ".module-removals" / f"{run_id}.json"
        request_path.parent.mkdir(exist_ok=True)
        request = {
            "version": 1,
            "project": project,
            "environment": environment,
            "source_commit": source_commit.lower(),
            "removed_modules": removed,
            "correlation_id": correlation_id,
        }
        request_path.write_text(json.dumps(request, indent=2) + "\n", encoding="utf-8")

    return removed, request_path


def write_github_output(path: Path, removed: list[str], request_path: Path | None) -> None:
    with path.open("a", encoding="utf-8") as output:
        output.write(f"removed_modules={','.join(removed) or 'none'}\n")
        output.write(f"removal_request={request_path or ''}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument("--project", required=True)
    parser.add_argument("--environment", required=True)
    parser.add_argument("--modules", default="")
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--correlation-id", default="none")
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()

    try:
        removed, request_path = reconcile(
            args.repository.resolve(),
            args.project,
            args.environment,
            args.modules,
            args.source_commit,
            args.run_id,
            args.correlation_id,
        )
    except (FileNotFoundError, ValueError) as error:
        parser.error(str(error))

    github_output = args.github_output or (
        Path(os.environ["GITHUB_OUTPUT"]) if "GITHUB_OUTPUT" in os.environ else None
    )
    if github_output:
        write_github_output(github_output, removed, request_path)

    print(",".join(removed) or "none")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
