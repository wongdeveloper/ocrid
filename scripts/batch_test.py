from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env")

from ktp_ai import KtpExtractor


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run OCRID extraction against a batch of images.")
    parser.add_argument("images", nargs="+", type=Path, help="Image paths to test.")
    parser.add_argument("--mode", choices=("auto", "ai", "local"), default="local")
    parser.add_argument("--json", type=Path, help="Write the complete results to this JSON file.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    paths = sorted(dict.fromkeys(path.expanduser().resolve() for path in args.images))
    extractor = KtpExtractor()
    results: list[dict] = []

    print(f"Running {len(paths)} image(s) with mode={args.mode}")
    for index, path in enumerate(paths, start=1):
        started = time.perf_counter()
        try:
            result = extractor.extract(path.read_bytes(), mode=args.mode)
            elapsed = round(time.perf_counter() - started, 2)
            item = {
                "file": str(path),
                "elapsedSeconds": elapsed,
                **result.model_dump(),
            }
            results.append(item)
            fields = result.fields
            identifier = fields.nik or fields.licenseNumber or "-"
            print(
                f"[{index:02}/{len(paths):02}] {path.name}: "
                f"{result.documentType:<7} id={identifier:<16} "
                f"name={fields.name or '-'} engine={result.engine} ({elapsed:.2f}s)"
            )
        except Exception as exc:
            elapsed = round(time.perf_counter() - started, 2)
            results.append(
                {
                    "file": str(path),
                    "elapsedSeconds": elapsed,
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
            print(f"[{index:02}/{len(paths):02}] {path.name}: ERROR {type(exc).__name__}: {exc}")

    summary = {
        "total": len(results),
        "errors": sum("error" in item for item in results),
        "ktp": sum(item.get("documentType") == "KTP" for item in results),
        "sim": sum(item.get("documentType") == "SIM" for item in results),
        "unknown": sum(item.get("documentType") == "UNKNOWN" for item in results),
        "withIdentifier": sum(
            bool(item.get("fields", {}).get("nik") or item.get("fields", {}).get("licenseNumber"))
            for item in results
        ),
        "withName": sum(bool(item.get("fields", {}).get("name")) for item in results),
        "withBirth": sum(bool(item.get("fields", {}).get("birth")) for item in results),
        "withAddress": sum(bool(item.get("fields", {}).get("address")) for item in results),
        "aiResults": sum(str(item.get("engine", "")).startswith("openai-vision:") for item in results),
        "localFallbacks": sum("fallback" in str(item.get("engine", "")) for item in results),
        "elapsedSeconds": round(sum(item["elapsedSeconds"] for item in results), 2),
    }
    print(json.dumps(summary, indent=2))

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps({"summary": summary, "results": results}, indent=2, ensure_ascii=True),
            encoding="utf-8",
        )
        print(f"Report: {args.json.resolve()}")

    return 1 if summary["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
