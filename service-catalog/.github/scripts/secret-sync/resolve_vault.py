#!/usr/bin/env python3
"""Resolve the authoritative Azure Key Vault for a repository vault directory.

The Secret Self-Service portal writes ``<vaultDir>/secrets.enc.yaml``. Before CI
decrypts anything, it must prove which Azure Key Vault that directory maps to.
This resolver reads the vault's own Terragrunt definition (plus the ``env.hcl`` /
``common.hcl`` files Terragrunt would load) and evaluates ``inputs.keyvaultname``.

It never infers a vault from the application or environment name, and it fails
closed: any unresolvable reference, unsupported expression, ambiguous include or
conflicting candidate name aborts with a non-zero exit and no vault.

Usage:
    resolve_vault.py --repo-root . --secrets-file infrastructure/x/dev/keyvault/secrets.enc.yaml
    resolve_vault.py --repo-root . --vault-dir infrastructure/x/dev/keyvault

Output: a single JSON object on stdout. Never prints secret material; it only
reads Terragrunt configuration, never the encrypted file.
"""

from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import sys
from dataclasses import dataclass, field
from typing import Any

import hcl2

# --------------------------------------------------------------------------- #
# Accepted repository layouts
# --------------------------------------------------------------------------- #

SECRETS_FILENAME = "secrets.enc.yaml"

# Directory form: infrastructure/.../keyvault, .../keyvault01, .../keyvault2
INFRA_VAULT_DIR_RE = re.compile(r"^infrastructure/.+/keyvault[0-9]*$")
# azureDatabricks/<environment>/keyvault
DATABRICKS_VAULT_DIR_RE = re.compile(r"^azureDatabricks/[^/]+/keyvault$")
# keyvault.hcl sibling form: any infrastructure directory holding a keyvault.hcl
INFRA_ANY_DIR_RE = re.compile(r"^infrastructure/.+$")

DEFINITION_TERRAGRUNT = "terragrunt.hcl"
DEFINITION_KEYVAULT_HCL = "keyvault.hcl"

# The Terragrunt input that names the Azure Key Vault in this repository.
VAULT_NAME_INPUT = "keyvaultname"
# Locals consulted (in order) for the owning subscription.
SUBSCRIPTION_LOCALS = ("currentsubID",)
# Locals consulted (in order) for the resource group, when statically knowable.
RESOURCE_GROUP_LOCALS = ("resource_group_name",)

AZURE_VAULT_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9-]{1,22}[A-Za-z0-9]$")
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")


class ResolutionError(Exception):
    """Raised whenever the vault cannot be resolved unambiguously."""


# --------------------------------------------------------------------------- #
# Minimal HCL expression evaluation
# --------------------------------------------------------------------------- #


@dataclass
class LocalsView:
    """The ``locals`` namespace of one parsed Terragrunt file."""

    config: "HclConfig"

    def get(self, name: str) -> Any:
        return self.config.local(name)

    def has(self, name: str) -> bool:
        return name in self.config.locals_raw


@dataclass
class HclConfig:
    """A parsed Terragrunt/HCL file plus the evaluation context it belongs to."""

    path: str  # absolute path of this file
    repo_root: str
    original_dir: str  # absolute vaultDir (get_original_terragrunt_dir)
    body: dict[str, Any]
    loader: "Loader"
    locals_raw: dict[str, Any] = field(default_factory=dict)
    _cache: dict[str, Any] = field(default_factory=dict)
    _in_progress: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        for block in self.body.get("locals", []) or []:
            if isinstance(block, dict):
                self.locals_raw.update(block)

    @property
    def dirname(self) -> str:
        """Directory of *this* file — Terragrunt's get_terragrunt_dir()."""
        return os.path.dirname(self.path)

    def local(self, name: str) -> Any:
        if name in self._cache:
            return self._cache[name]
        if name not in self.locals_raw:
            raise ResolutionError(
                f"local '{name}' is not defined in {self.rel(self.path)}"
            )
        if name in self._in_progress:
            raise ResolutionError(
                f"circular reference resolving local '{name}' in {self.rel(self.path)}"
            )
        self._in_progress.add(name)
        try:
            value = self.evaluate(self.locals_raw[name])
        finally:
            self._in_progress.discard(name)
        self._cache[name] = value
        return value

    def rel(self, abs_path: str) -> str:
        return os.path.relpath(abs_path, self.repo_root)

    # -- expression entry point -------------------------------------------- #

    def evaluate(self, node: Any) -> Any:
        if isinstance(node, bool) or isinstance(node, (int, float)):
            return node
        if node is None:
            return None
        if isinstance(node, list):
            return [self.evaluate(n) for n in node]
        if isinstance(node, dict):
            return {k: self.evaluate(v) for k, v in node.items()}
        if not isinstance(node, str):
            raise ResolutionError(f"unsupported HCL node type: {type(node).__name__}")
        return self._eval_template(node)

    def _eval_template(self, text: str) -> Any:
        """Evaluate a python-hcl2 string, which embeds expressions as ${...}."""
        parts = _split_template(text)
        if len(parts) == 1 and isinstance(parts[0], _Expr):
            # Whole string is a single expression: preserve its native type so
            # read_terragrunt_config(...) can return a config namespace.
            return self._eval_expr(parts[0].source)
        out: list[str] = []
        for part in parts:
            if isinstance(part, _Expr):
                value = self._eval_expr(part.source)
                out.append(_stringify(value))
            else:
                out.append(part)
        return "".join(out)

    # -- tiny recursive-descent expression parser --------------------------- #

    def _eval_expr(self, source: str) -> Any:
        parser = _Parser(source)
        value = self._eval_node(parser.parse())
        return value

    def _eval_node(self, node: Any) -> Any:
        kind = node[0]
        if kind == "lit":
            return node[1]
        if kind == "list":
            return [self._eval_node(item) for item in node[1]]
        if kind == "str":
            return self._eval_template(node[1])
        if kind == "call":
            name, arg_nodes = node[1], node[2]
            return self._call(name, arg_nodes)
        if kind == "ref":
            return self._reference(node[1])
        if kind == "bin":
            op, left, right = node[1], node[2], node[3]
            lhs, rhs = self._eval_node(left), self._eval_node(right)
            if op == "==":
                return lhs == rhs
            if op == "!=":
                return lhs != rhs
            raise ResolutionError(f"unsupported operator '{op}'")
        if kind == "tern":
            # Evaluate only the taken branch: the untaken one may legitimately
            # be non-deterministic (e.g. an undefaulted get_env).
            condition = self._eval_node(node[1])
            if not isinstance(condition, bool):
                raise ResolutionError("ternary condition did not evaluate to a boolean")
            return self._eval_node(node[2] if condition else node[3])
        raise ResolutionError(f"unsupported expression node: {kind}")

    def _reference(self, parts: list[str]) -> Any:
        head, rest = parts[0], parts[1:]
        if head == "local":
            if not rest:
                raise ResolutionError("bare 'local' reference")
            value = self.local(rest[0])
            rest = rest[1:]
        else:
            raise ResolutionError(
                f"unsupported reference '{'.'.join(parts)}' "
                "(only 'local.*' is resolvable without running Terraform)"
            )
        for attr in rest:
            value = _attr(value, attr, ".".join(parts))
        return value

    def _call(self, name: str, arg_nodes: list[Any]) -> Any:
        # Functions whose arguments must stay unevaluated are handled first.
        if name == "get_terragrunt_dir":
            _expect_args(name, arg_nodes, 0)
            return self.dirname
        if name in ("get_original_terragrunt_dir", "get_parent_terragrunt_dir"):
            _expect_args(name, arg_nodes, 0)
            if name == "get_parent_terragrunt_dir":
                return os.path.dirname(self.loader.root_config_dir(self.original_dir))
            return self.original_dir
        if name == "get_env":
            # Only a defaulted get_env is deterministic in this context.
            if len(arg_nodes) != 2:
                raise ResolutionError(
                    "get_env() without a default is not deterministic during "
                    "vault resolution"
                )
            return self._eval_node(arg_nodes[1])
        if name == "find_in_parent_folders":
            _expect_args(name, arg_nodes, 1)
            target = self._eval_node(arg_nodes[0])
            return self.loader.find_in_parent_folders(self.original_dir, str(target))
        if name == "read_terragrunt_config":
            if len(arg_nodes) not in (1, 2):
                raise ResolutionError("read_terragrunt_config() arity")
            target = self._eval_node(arg_nodes[0])
            return self.loader.load(str(target), self.original_dir)
        if name == "path_relative_to_include":
            root_dir = self.loader.root_config_dir(self.original_dir)
            return os.path.relpath(self.original_dir, root_dir)

        args = [self._eval_node(a) for a in arg_nodes]
        return _pure_function(name, args)


def _attr(value: Any, attr: str, full: str) -> Any:
    if isinstance(value, HclConfig):
        if attr == "locals":
            return LocalsView(value)
        raise ResolutionError(
            f"'{full}': only '.locals' is supported on a Terragrunt config"
        )
    if isinstance(value, LocalsView):
        return value.get(attr)
    if isinstance(value, dict):
        if attr not in value:
            raise ResolutionError(f"'{full}': key '{attr}' not present")
        return value[attr]
    raise ResolutionError(f"'{full}': cannot read attribute '{attr}'")


def _stringify(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float, str)):
        return str(value)
    raise ResolutionError(
        "expression interpolates a non-scalar value; refusing to guess its string form"
    )


def _expect_args(name: str, args: list[Any], count: int) -> None:
    if len(args) != count:
        raise ResolutionError(f"{name}() expects {count} argument(s), got {len(args)}")


def _pure_function(name: str, args: list[Any]) -> Any:
    """Terraform built-ins that are safe and deterministic to evaluate here."""
    if name == "contains":
        _expect_args(name, args, 2)
        collection, value = args
        if not isinstance(collection, (list, tuple)):
            raise ResolutionError("contains() first argument is not a list")
        return value in collection
    if name == "basename":
        _expect_args(name, args, 1)
        return posixpath.basename(_clean_path(str(args[0])))
    if name == "dirname":
        _expect_args(name, args, 1)
        return _tf_dirname(str(args[0]))
    if name == "lower":
        _expect_args(name, args, 1)
        return str(args[0]).lower()
    if name == "upper":
        _expect_args(name, args, 1)
        return str(args[0]).upper()
    if name == "trimspace":
        _expect_args(name, args, 1)
        return str(args[0]).strip()
    if name == "substr":
        _expect_args(name, args, 3)
        text, offset, length = str(args[0]), int(args[1]), int(args[2])
        if offset < 0:
            offset = len(text) + offset
        if length < 0:
            return text[offset:]
        return text[offset : offset + length]
    if name == "format":
        if not args:
            raise ResolutionError("format() needs a spec")
        spec = str(args[0])
        try:
            return spec % tuple(args[1:])
        except (TypeError, ValueError) as exc:
            raise ResolutionError(f"format() failed: {exc}") from exc
    if name == "join":
        _expect_args(name, args, 2)
        return str(args[0]).join(str(x) for x in args[1])
    if name == "replace":
        _expect_args(name, args, 3)
        return str(args[0]).replace(str(args[1]), str(args[2]))
    if name == "lookup":
        if len(args) not in (2, 3):
            raise ResolutionError("lookup() expects 2 or 3 arguments")
        container, key = args[0], str(args[1])
        try:
            if isinstance(container, LocalsView):
                if not container.has(key):
                    raise KeyError(key)
                return container.get(key)
            if isinstance(container, dict):
                return container[key]
            raise ResolutionError("lookup() first argument is not a map")
        except KeyError:
            if len(args) == 3:
                return args[2]
            raise ResolutionError(f"lookup(): key '{key}' not found and no default")
    if name in ("try", "coalesce"):
        raise ResolutionError(
            f"{name}() makes vault resolution non-deterministic; refusing"
        )
    raise ResolutionError(f"unsupported Terragrunt/Terraform function '{name}()'")


def _clean_path(path: str) -> str:
    return posixpath.normpath(path)


def _tf_dirname(path: str) -> str:
    """Match Terraform's dirname(), which is Go's filepath.Dir.

    Go splits at the *last* separator and only then cleans, so a trailing slash
    changes the result. Verified against `terraform console`:

        dirname("/a/b/c/keyvault/")  == "/a/b/c"     # trailing slash: clean(p)
        dirname("/a/b/c/keyvault")      == "/a/b/c"     # no slash: clean(parent)

    Getting this wrong silently resolves a vault name one directory level off,
    so it is implemented literally rather than via posixpath.dirname().
    """
    index = path.rfind("/")
    if index < 0:
        return "."
    return posixpath.normpath(path[: index + 1])


# --------------------------------------------------------------------------- #
# Template + expression tokenising
# --------------------------------------------------------------------------- #


@dataclass
class _Expr:
    source: str


def _split_template(text: str) -> list[Any]:
    """Split a python-hcl2 string into literal chunks and ${...} expressions."""
    parts: list[Any] = []
    buf: list[str] = []
    i, n = 0, len(text)
    while i < n:
        if text.startswith("${", i):
            depth, j, in_str = 1, i + 2, False
            while j < n and depth:
                ch = text[j]
                if in_str:
                    if ch == "\\":
                        j += 1
                    elif ch == '"':
                        in_str = False
                elif ch == '"':
                    in_str = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            if depth:
                raise ResolutionError("unterminated ${...} in expression")
            if buf:
                parts.append("".join(buf))
                buf = []
            parts.append(_Expr(text[i + 2 : j]))
            i = j + 1
            continue
        buf.append(text[i])
        i += 1
    if buf:
        parts.append("".join(buf))
    return parts or [""]


_TOKEN_RE = re.compile(
    r"""
    (?:
      (?P<string>"(?:[^"\\]|\\.)*")
    | (?P<number>-?\d+(?:\.\d+)?)
    | (?P<ident>[A-Za-z_][A-Za-z0-9_-]*)
    | (?P<punct>==|!=|[().,?:\[\]])
    )
    """,
    re.VERBOSE,
)


class _Parser:
    """Recursive-descent parser for the HCL subset used by vault definitions."""

    def __init__(self, source: str) -> None:
        self.source = source
        self.tokens = self._tokenise(source)
        self.pos = 0

    @staticmethod
    def _tokenise(source: str) -> list[tuple[str, str]]:
        tokens: list[tuple[str, str]] = []
        pos = 0
        while pos < len(source):
            if source[pos].isspace():
                pos += 1
                continue
            match = _TOKEN_RE.match(source, pos)
            if not match or match.end() == pos:
                raise ResolutionError(
                    f"cannot parse expression near: {source[pos:pos + 24]!r}"
                )
            kind = match.lastgroup
            tokens.append((kind, match.group(kind)))
            pos = match.end()
        return tokens

    def parse(self) -> Any:
        node = self._parse_ternary()
        if self.pos != len(self.tokens):
            raise ResolutionError(
                f"unsupported expression (trailing tokens): {self.source!r}"
            )
        return node

    def _peek(self) -> tuple[str, str] | None:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def _next(self) -> tuple[str, str]:
        if self.pos >= len(self.tokens):
            raise ResolutionError(f"unexpected end of expression: {self.source!r}")
        token = self.tokens[self.pos]
        self.pos += 1
        return token

    def _expect(self, text: str) -> None:
        kind, actual = self._next()
        if actual != text:
            raise ResolutionError(
                f"expected {text!r} but found {actual!r} in {self.source!r}"
            )

    def _parse_ternary(self) -> Any:
        condition = self._parse_equality()
        if self._peek() == ("punct", "?"):
            self._next()
            when_true = self._parse_ternary()
            self._expect(":")
            when_false = self._parse_ternary()
            return ("tern", condition, when_true, when_false)
        return condition

    def _parse_equality(self) -> Any:
        left = self._parse_value()
        while True:
            nxt = self._peek()
            if nxt and nxt[0] == "punct" and nxt[1] in ("==", "!="):
                self._next()
                right = self._parse_value()
                left = ("bin", nxt[1], left, right)
            else:
                return left

    def _parse_value(self) -> Any:
        kind, text = self._next()
        if kind == "string":
            return ("str", _unquote(text))
        if kind == "number":
            return ("lit", float(text) if "." in text else int(text))
        if kind == "punct" and text == "[":
            items: list[Any] = []
            if self._peek() == ("punct", "]"):
                self._next()
                return ("list", items)
            while True:
                items.append(self._parse_ternary())
                kind, text = self._next()
                if (kind, text) == ("punct", "]"):
                    return ("list", items)
                if (kind, text) != ("punct", ","):
                    raise ResolutionError(f"bad list literal in {self.source!r}")
        if kind == "punct" and text == "(":
            node = self._parse_ternary()
            self._expect(")")
            return node
        if kind == "ident":
            if text in ("true", "false"):
                return ("lit", text == "true")
            if text == "null":
                return ("lit", None)
            nxt = self._peek()
            if nxt and nxt == ("punct", "("):
                self._next()
                args = self._parse_args()
                return ("call", text, args)
            parts = [text]
            while True:
                nxt = self._peek()
                if nxt and nxt == ("punct", "."):
                    self._next()
                    _, attr = self._next()
                    parts.append(attr)
                else:
                    break
            return ("ref", parts)
        raise ResolutionError(f"unsupported token {text!r} in {self.source!r}")

    def _parse_args(self) -> list[Any]:
        args: list[Any] = []
        if self._peek() == ("punct", ")"):
            self._next()
            return args
        while True:
            args.append(self._parse_ternary())
            kind, text = self._next()
            if (kind, text) == ("punct", ")"):
                return args
            if (kind, text) != ("punct", ","):
                raise ResolutionError(f"bad argument list in {self.source!r}")


def _unquote(text: str) -> str:
    body = text[1:-1]
    return body.replace('\\"', '"').replace("\\\\", "\\")


# --------------------------------------------------------------------------- #
# File loading with Terragrunt lookup semantics
# --------------------------------------------------------------------------- #

ROOT_CONFIG_NAMES = ("root.hcl", "terragrunt.hcl")


class Loader:
    def __init__(self, repo_root: str) -> None:
        self.repo_root = os.path.realpath(repo_root)
        self._files: dict[tuple[str, str], HclConfig] = {}

    def _parse(self, abs_path: str, original_dir: str) -> HclConfig:
        key = (abs_path, original_dir)
        if key in self._files:
            return self._files[key]
        try:
            with open(abs_path, "r", encoding="utf-8") as handle:
                body = hcl2.load(handle)
        except OSError as exc:
            raise ResolutionError(f"cannot read {self.rel(abs_path)}: {exc}") from exc
        except Exception as exc:  # hcl2 raises assorted parser errors
            raise ResolutionError(
                f"cannot parse {self.rel(abs_path)} as HCL: {exc}"
            ) from exc
        config = HclConfig(
            path=abs_path,
            repo_root=self.repo_root,
            original_dir=original_dir,
            body=body,
            loader=self,
        )
        self._files[key] = config
        return config

    def rel(self, abs_path: str) -> str:
        return os.path.relpath(abs_path, self.repo_root)

    def _inside_repo(self, abs_path: str) -> bool:
        real = os.path.realpath(abs_path)
        return real == self.repo_root or real.startswith(self.repo_root + os.sep)

    def load(self, path: str, original_dir: str) -> HclConfig:
        abs_path = path if os.path.isabs(path) else os.path.join(original_dir, path)
        abs_path = os.path.realpath(abs_path)
        if not self._inside_repo(abs_path):
            raise ResolutionError("refusing to read a Terragrunt file outside the repository")
        if not os.path.isfile(abs_path):
            raise ResolutionError(f"referenced Terragrunt file not found: {path}")
        return self._parse(abs_path, original_dir)

    def find_in_parent_folders(self, start_dir: str, name: str) -> str:
        """Terragrunt's find_in_parent_folders(): search strictly upward."""
        current = os.path.dirname(os.path.realpath(start_dir))
        while True:
            candidate = os.path.join(current, name)
            if os.path.isfile(candidate):
                return candidate
            if os.path.realpath(current) == self.repo_root:
                break
            parent = os.path.dirname(current)
            if parent == current:
                break
            current = parent
        raise ResolutionError(
            f"find_in_parent_folders(\"{name}\") found nothing above "
            f"{self.rel(start_dir)}"
        )

    def root_config_dir(self, start_dir: str) -> str:
        """Directory of the nearest ancestor root Terragrunt config."""
        current = os.path.dirname(os.path.realpath(start_dir))
        while True:
            for name in ROOT_CONFIG_NAMES:
                if os.path.isfile(os.path.join(current, name)):
                    return current
            if os.path.realpath(current) == self.repo_root:
                break
            parent = os.path.dirname(current)
            if parent == current:
                break
            current = parent
        raise ResolutionError(
            f"no root Terragrunt config found above {self.rel(start_dir)}"
        )

    def resolve_include_path(self, config: HclConfig, raw_path: str) -> str:
        """Resolve an include path, requiring exactly one existing candidate."""
        rendered = config.evaluate(raw_path)
        if not isinstance(rendered, str):
            raise ResolutionError("include path did not render to a string")
        if os.path.isabs(rendered):
            candidates = [rendered]
        else:
            bases: list[str] = [config.original_dir]
            current = config.original_dir
            while True:
                bases.append(current)
                if os.path.realpath(current) == self.repo_root:
                    break
                parent = os.path.dirname(current)
                if parent == current:
                    break
                current = parent
            candidates = [os.path.join(base, rendered) for base in bases]
        found = []
        for candidate in candidates:
            real = os.path.realpath(candidate)
            if os.path.isfile(real) and self._inside_repo(real) and real not in found:
                found.append(real)
        if not found:
            raise ResolutionError(f"include path '{rendered}' matches no file in the repository")
        if len(found) > 1:
            raise ResolutionError(
                f"include path '{rendered}' is ambiguous: "
                + ", ".join(self.rel(f) for f in found)
            )
        return found[0]


# --------------------------------------------------------------------------- #
# Vault resolution
# --------------------------------------------------------------------------- #


def _inputs_blocks(body: dict[str, Any]) -> list[dict[str, Any]]:
    raw = body.get("inputs")
    if raw is None:
        return []
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        return [b for b in raw if isinstance(b, dict)]
    return []


def classify_vault_dir(vault_dir_rel: str, repo_root: str) -> tuple[str, str]:
    """Return (layout, definition_file_rel) or raise. Fails closed."""
    vault_dir_rel = vault_dir_rel.strip("/")
    if vault_dir_rel.startswith("/") or any(
        seg in ("", ".", "..") for seg in vault_dir_rel.split("/")
    ):
        raise ResolutionError(f"path traversal or empty segment: {vault_dir_rel}")

    abs_dir = os.path.join(repo_root, vault_dir_rel)
    real_dir = os.path.realpath(abs_dir)
    if real_dir != abs_dir or not (
        real_dir == repo_root or real_dir.startswith(repo_root + os.sep)
    ):
        raise ResolutionError(f"vault directory resolves outside the repository: {vault_dir_rel}")
    if not os.path.isdir(abs_dir):
        raise ResolutionError(f"vault directory does not exist: {vault_dir_rel}")

    terragrunt = os.path.join(abs_dir, DEFINITION_TERRAGRUNT)
    keyvault_hcl = os.path.join(abs_dir, DEFINITION_KEYVAULT_HCL)

    if DATABRICKS_VAULT_DIR_RE.match(vault_dir_rel):
        if not os.path.isfile(terragrunt):
            raise ResolutionError(
                f"{vault_dir_rel} matches the azureDatabricks layout but has no "
                f"{DEFINITION_TERRAGRUNT}"
            )
        return "azureDatabricks", f"{vault_dir_rel}/{DEFINITION_TERRAGRUNT}"

    if INFRA_VAULT_DIR_RE.match(vault_dir_rel):
        if os.path.isfile(terragrunt):
            return "infrastructure-keyvault-dir", f"{vault_dir_rel}/{DEFINITION_TERRAGRUNT}"
        if os.path.isfile(keyvault_hcl):
            return "infrastructure-keyvault-hcl", f"{vault_dir_rel}/{DEFINITION_KEYVAULT_HCL}"
        raise ResolutionError(
            f"{vault_dir_rel} has neither {DEFINITION_TERRAGRUNT} nor "
            f"{DEFINITION_KEYVAULT_HCL}"
        )

    if INFRA_ANY_DIR_RE.match(vault_dir_rel):
        # Broad infrastructure rule: only valid with a sibling keyvault.hcl.
        if os.path.isfile(keyvault_hcl):
            return "infrastructure-keyvault-hcl", f"{vault_dir_rel}/{DEFINITION_KEYVAULT_HCL}"
        raise ResolutionError(
            f"{vault_dir_rel} is not a keyvault directory and has no sibling "
            f"{DEFINITION_KEYVAULT_HCL}; refusing"
        )

    raise ResolutionError(f"{vault_dir_rel} is outside every accepted vault layout")


def vault_dir_for_secrets_file(secrets_file_rel: str, repo_root: str) -> str:
    secrets_file_rel = secrets_file_rel.strip("/")
    if posixpath.basename(secrets_file_rel) != SECRETS_FILENAME:
        raise ResolutionError(
            f"path must end in {SECRETS_FILENAME}: {secrets_file_rel}"
        )
    if ".." in secrets_file_rel.split("/"):
        raise ResolutionError("path traversal is not allowed")
    root = secrets_file_rel.split("/", 1)[0]
    if root not in ("infrastructure", "azureDatabricks"):
        raise ResolutionError(
            f"'{root}/' is not an accepted root (expected infrastructure/ or azureDatabricks/)"
        )
    return posixpath.dirname(secrets_file_rel)


def _collect_candidate_configs(
    loader: Loader, definition: HclConfig
) -> list[HclConfig]:
    """The definition file plus any statically resolvable in-repo includes."""
    configs = [definition]
    for include_block in definition.body.get("include", []) or []:
        if not isinstance(include_block, dict):
            continue
        # python-hcl2 renders both labelled and unlabelled include blocks.
        entries = []
        if "path" in include_block:
            entries.append(include_block)
        else:
            entries.extend(v for v in include_block.values() if isinstance(v, dict))
        for entry in entries:
            raw_path = entry.get("path")
            if not isinstance(raw_path, str):
                continue
            try:
                abs_path = loader.resolve_include_path(definition, raw_path)
            except ResolutionError:
                # A root include we cannot resolve is fine as long as some other
                # config supplies the vault name; if none does we fail closed later.
                continue
            configs.append(loader._parse(abs_path, definition.original_dir))
    return configs


def _resolve_vault_name(configs: list[HclConfig]) -> tuple[str, str]:
    """Evaluate inputs.keyvaultname across candidates; require one distinct value."""
    found: list[tuple[str, str]] = []  # (value, source file)
    errors: list[str] = []
    for config in configs:
        for block in _inputs_blocks(config.body):
            if VAULT_NAME_INPUT not in block:
                continue
            try:
                value = config.evaluate(block[VAULT_NAME_INPUT])
            except ResolutionError as exc:
                errors.append(f"{config.rel(config.path)}: {exc}")
                continue
            if not isinstance(value, str) or not value.strip():
                errors.append(
                    f"{config.rel(config.path)}: {VAULT_NAME_INPUT} did not "
                    "evaluate to a non-empty string"
                )
                continue
            found.append((value.strip(), config.rel(config.path)))

    if not found:
        detail = "; ".join(errors) if errors else "no inputs.keyvaultname declared"
        raise ResolutionError(f"could not resolve {VAULT_NAME_INPUT}: {detail}")

    distinct = sorted({value for value, _ in found})
    if len(distinct) > 1:
        raise ResolutionError(
            "ambiguous vault mapping: "
            + ", ".join(f"{v} (from {s})" for v, s in found)
        )
    return found[0]


def _resolve_optional_local(configs: list[HclConfig], names: tuple[str, ...]) -> str | None:
    """Best-effort lookup of a scalar local across the definition's config chain."""
    seen: list[str] = []
    for config in configs:
        namespaces: list[Any] = [LocalsView(config)]
        for alias in ("config", "env", "common_vars"):
            if alias in config.locals_raw:
                try:
                    value = config.local(alias)
                except ResolutionError:
                    continue
                if isinstance(value, HclConfig):
                    namespaces.append(LocalsView(value))
        for namespace in namespaces:
            for name in names:
                if not namespace.has(name):
                    continue
                try:
                    value = namespace.get(name)
                except ResolutionError:
                    continue
                if isinstance(value, str) and value.strip() and value.strip() not in seen:
                    seen.append(value.strip())
    if len(seen) == 1:
        return seen[0]
    return None


def resolve(repo_root: str, vault_dir_rel: str) -> dict[str, Any]:
    repo_root = os.path.realpath(repo_root)
    layout, definition_rel = classify_vault_dir(vault_dir_rel, repo_root)
    loader = Loader(repo_root)
    abs_definition = os.path.join(repo_root, definition_rel)
    abs_vault_dir = os.path.join(repo_root, vault_dir_rel)
    real_definition = os.path.realpath(abs_definition)
    real_vault_dir = os.path.realpath(abs_vault_dir)
    if not loader._inside_repo(real_definition):
        raise ResolutionError(
            f"vault definition resolves outside the repository (symlink?): {definition_rel}"
        )
    definition = loader._parse(real_definition, real_vault_dir)
    configs = _collect_candidate_configs(loader, definition)
    vault_name, source = _resolve_vault_name(configs)

    if not AZURE_VAULT_NAME_RE.match(vault_name):
        raise ResolutionError(
            f"resolved vault name '{vault_name}' is not a valid Azure Key Vault name"
        )

    subscription = _resolve_optional_local(configs, SUBSCRIPTION_LOCALS)
    if subscription is not None and not UUID_RE.match(subscription):
        # A non-UUID subscription local means the lookup silently defaulted.
        subscription = None
    resource_group = _resolve_optional_local(configs, RESOURCE_GROUP_LOCALS)

    return {
        "vaultDir": vault_dir_rel.strip("/"),
        "layout": layout,
        "definitionFile": definition_rel,
        "vaultNameSource": f"{source}:inputs.{VAULT_NAME_INPUT}",
        "keyVaultName": vault_name,
        "subscriptionId": subscription,
        "resourceGroupName": resource_group,
        "secretsFile": f"{vault_dir_rel.strip('/')}/{SECRETS_FILENAME}",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", default=".")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--secrets-file")
    group.add_argument("--vault-dir")
    args = parser.parse_args(argv)

    try:
        if args.secrets_file:
            vault_dir = vault_dir_for_secrets_file(args.secrets_file, args.repo_root)
        else:
            vault_dir = args.vault_dir
        result = resolve(args.repo_root, vault_dir)
    except ResolutionError as exc:
        print(f"vault resolution failed: {exc}", file=sys.stderr)
        return 2
    json.dump(result, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
