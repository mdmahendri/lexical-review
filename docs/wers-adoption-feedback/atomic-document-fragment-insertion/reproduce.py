#!/usr/bin/env python3
"""Replay the WER v1 boundary proof for one atomic multiline paste."""

from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import platform
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path
from typing import Any


BUNDLE = Path(__file__).resolve().parent
REPOSITORY = BUNDLE.parents[2]
FIXTURE_PATH = BUNDLE / "fixture.json"
EXPECTED_PATH = BUNDLE / "expected.json"
OBSERVED_PATH = BUNDLE / "observed.json"
LEXICAL_OBSERVATION = BUNDLE / "lexical-observation.mjs"


def run(*command: str, cwd: Path | None = None) -> str:
    result = subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return result.stdout.strip()


def load_wer(wer_repository: Path, expected_commit: str) -> Any:
    actual_commit = run("git", "rev-parse", "HEAD", cwd=wer_repository)
    if actual_commit != expected_commit:
        raise RuntimeError(
            f"WER checkout must be at {expected_commit}, found {actual_commit}"
        )
    if run("git", "status", "--porcelain", cwd=wer_repository):
        raise RuntimeError("WER checkout must be clean")

    module_path = (
        wer_repository / "standards/v1/evaluation/run_conformance.py"
    )
    spec = importlib.util.spec_from_file_location("wer_v1_conformance", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load WER oracle from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def paragraphs(document: dict[str, Any]) -> list[list[str]]:
    return [
        [item["id"], item["text"]]
        for item in document["acceptedState"]["paragraphs"]
    ]


def proposal_from_fixture(value: dict[str, Any]) -> dict[str, Any]:
    proposal = copy.deepcopy(value)
    proposal["baseFingerprint"] = ""
    proposal["state"] = "pending"
    return proposal


def make_document(wer: Any, proposals: list[dict[str, Any]]) -> dict[str, Any]:
    return wer.make_document(
        [wer.paragraph("p1", "AB")],
        [proposal_from_fixture(item) for item in proposals],
    )


def observe_lexical() -> dict[str, Any]:
    return json.loads(run("node", str(LEXICAL_OBSERVATION), cwd=REPOSITORY))


def observe_wer(wer: Any, fixture: dict[str, Any]) -> dict[str, Any]:
    candidates = fixture["candidates"]

    single_insert = make_document(wer, [candidates["singleInsert"]])
    wer.validate_semantics(single_insert)
    single_insert_accept = wer.resolve(single_insert, {"paste": "accepted"})
    single_insert_reject = wer.resolve(single_insert, {"paste": "rejected"})

    single_split = make_document(wer, [candidates["singleSplit"]])
    wer.validate_semantics(single_split)
    single_split_accept = wer.resolve(single_split, {"paste": "accepted"})
    single_split_reject = wer.resolve(single_split, {"paste": "rejected"})

    dependent = make_document(wer, candidates["dependentDecomposition"])
    dependent_error = None
    try:
        wer.validate_semantics(dependent)
    except wer.ConformanceError as error:
        dependent_error = str(error)
    if dependent_error is None:
        raise AssertionError("dependent decomposition unexpectedly validated")

    decomposition = make_document(wer, candidates["validDecomposition"])
    wer.validate_semantics(decomposition)
    after_split = wer.resolve(decomposition, {"split": "accepted"})
    complete_accept = wer.resolve(
        after_split,
        {"insert-left": "accepted", "insert-right": "accepted"},
    )
    left_only = wer.resolve(
        after_split,
        {"insert-left": "accepted", "insert-right": "rejected"},
    )
    right_only = wer.resolve(
        after_split,
        {"insert-left": "rejected", "insert-right": "accepted"},
    )
    neither_insert = wer.resolve(
        after_split,
        {"insert-left": "rejected", "insert-right": "rejected"},
    )
    complete_reject = wer.resolve(
        decomposition,
        {
            "insert-left": "rejected",
            "insert-right": "rejected",
            "split": "rejected",
        },
    )

    report = copy.deepcopy(fixture["unsupportedMappingReport"])
    derived_outcome, conforming = wer.derive_mapping_outcome(report)
    wer.validate_mapping_report(report)

    core_checks = []
    for test in wer.TESTS:
        test.function()
        core_checks.append(test.name)

    return {
        "publishedCoreOracle": {
            "checksPassed": len(core_checks),
            "checkNames": core_checks,
        },
        "singleInsert": {
            "valid": True,
            "accept": paragraphs(single_insert_accept),
            "reject": paragraphs(single_insert_reject),
            "matchesRequiredAccept": False,
            "reason": "The newline remains text inside p1; no paragraph identity is created.",
        },
        "singleSplit": {
            "valid": True,
            "accept": paragraphs(single_split_accept),
            "reject": paragraphs(single_split_reject),
            "matchesRequiredAccept": False,
            "reason": "The split creates structure but carries no inserted content payload.",
        },
        "dependentDecomposition": {
            "valid": False,
            "error": dependent_error,
            "reason": "A pending insertion cannot target the right paragraph created by a pending split.",
        },
        "validDecomposition": {
            "valid": True,
            "afterSplit": paragraphs(after_split),
            "completeAccept": paragraphs(complete_accept),
            "completeReject": paragraphs(complete_reject),
            "partialOutcomes": {
                "leftOnly": paragraphs(left_only),
                "rightOnly": paragraphs(right_only),
                "neitherInsert": paragraphs(neither_insert),
            },
            "matchesRequiredAccept": True,
            "matchesRequiredReject": True,
            "preservesOneProposalAtomicity": False,
        },
        "unsupportedMappingReport": {
            "derivedOutcome": derived_outcome,
            "conforming": conforming,
            "outputMutation": report["outputMutation"],
        },
        "conclusion": {
            "werV1CoreProposalExists": False,
            "currentCompatibleBehavior": "refuse-without-mutation-and-report-unsupported",
            "smallestRemedy": "Add one future-standard atomic document-fragment insertion proposal kind with a point target, ordered paragraph fragments, and reserved identities for every created paragraph.",
        },
    }


def environment(fixture: dict[str, Any], wer_repository: Path) -> dict[str, Any]:
    lexical_boundary = fixture["boundaries"]["lexical"]
    baseline = fixture["boundaries"]["lexicalReview"]["baselineCommit"]
    run("git", "merge-base", "--is-ancestor", baseline, "HEAD", cwd=REPOSITORY)

    installed_versions = {}
    package_root = REPOSITORY / "packages/lexical-review/node_modules"
    for package in ("lexical", "@lexical/clipboard", "@lexical/react", "@lexical/utils"):
        package_json = package_root / package / "package.json"
        installed_versions[package] = json.loads(
            package_json.read_text(encoding="utf-8")
        )["version"]
    if set(installed_versions.values()) != {lexical_boundary["version"]}:
        raise RuntimeError(f"unaligned installed Lexical graph: {installed_versions}")

    return {
        "lexicalReviewBaselineCommit": baseline,
        "lexicalReviewObservedHead": run("git", "rev-parse", "HEAD", cwd=REPOSITORY),
        "lexicalReviewWorkingTree": run(
            "git", "status", "--short", cwd=REPOSITORY
        ).splitlines(),
        "webEditorRevisionsCommit": run("git", "rev-parse", "HEAD", cwd=wer_repository),
        "lexicalTagCommit": lexical_boundary["commit"],
        "installedLexicalPackages": installed_versions,
        "node": run("node", "--version"),
        "pnpm": run("pnpm", "--version", cwd=REPOSITORY),
        "python": platform.python_version(),
        "jsonschema": version("jsonschema"),
        "platform": platform.platform(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--wer-repo",
        type=Path,
        default=REPOSITORY.parent / "web-editor-revisions",
    )
    parser.add_argument("--write-observed", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    wer_repository = args.wer_repo.resolve()
    wer = load_wer(
        wer_repository,
        fixture["boundaries"]["webEditorRevisions"]["commit"],
    )
    lexical = observe_lexical()
    required_text = [item["text"] for item in fixture["requiredProjections"]["accept"]]
    if lexical["paragraphs"] != required_text:
        raise AssertionError(
            f"Lexical observation {lexical['paragraphs']} != required {required_text}"
        )

    results = {
        "lexicalRuntime": lexical,
        "werV1": observe_wer(wer, fixture),
    }
    observed = {
        "fixture": fixture["id"],
        "environment": environment(fixture, wer_repository),
        "results": results,
    }
    rendered = json.dumps(observed, indent=2, ensure_ascii=False) + "\n"

    if args.write_observed:
        OBSERVED_PATH.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")

    if args.check:
        expected = json.loads(EXPECTED_PATH.read_text(encoding="utf-8"))
        if results != expected:
            raise AssertionError("observed semantic results differ from expected.json")
        if json.loads(OBSERVED_PATH.read_text(encoding="utf-8"))["results"] != results:
            raise AssertionError("committed observed.json differs from replayed results")
        print("PASS atomic document-fragment insertion boundary proof")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
