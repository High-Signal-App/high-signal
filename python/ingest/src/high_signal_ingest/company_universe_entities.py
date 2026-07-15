"""Add build-time GLiNER facets to the generated company universe.

This is a manual, idempotent enrichment pass. It keeps model inference out of
the web request path while giving company search and similarity clustering
structured product concepts to rank on.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

DEFAULT_MODEL = "urchade/gliner_small-v2.1"
DEFAULT_LABELS: tuple[str, ...] = (
    "product capability",
    "use case",
    "target customer",
    "industry",
    "technology",
    "product",
)
DEFAULT_THRESHOLD = 0.42
DEFAULT_ARTIFACT = (
    Path(__file__).resolve().parents[4] / "apps/web/src/data/company-universe.json"
)


def normalize_predictions(predictions: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return bounded, deterministic, de-duplicated entity facets."""
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for prediction in predictions:
        text = " ".join(str(prediction.get("text") or "").split()).strip(" ,.;:-")
        label = " ".join(str(prediction.get("label") or "").lower().split())
        score = round(float(prediction.get("score") or 0), 4)
        if not text or not label or len(text) < 2 or len(text) > 120:
            continue
        key = (text.casefold(), label)
        existing = by_key.get(key)
        if existing is None or score > existing["score"]:
            by_key[key] = {"text": text, "label": label, "score": score}
    return sorted(by_key.values(), key=lambda item: (-item["score"], item["label"], item["text"]))[:16]


def company_text(company: dict[str, Any]) -> str:
    evidence = company.get("sourceEvidence") or []
    evidence_descriptions = [
        str(item.get("description") or "")
        for item in evidence
        if isinstance(item, dict)
    ]
    return "\n".join(
        part
        for part in [
            str(company.get("name") or ""),
            str(company.get("description") or ""),
            *evidence_descriptions,
        ]
        if part
    )[:1800]


def enrich(
    artifact_path: Path = DEFAULT_ARTIFACT,
    model_name: str = DEFAULT_MODEL,
    threshold: float = DEFAULT_THRESHOLD,
    batch_size: int = 24,
    chunk_size: int = 256,
    device: str = "auto",
    limit: int | None = None,
) -> int:
    from gliner import GLiNER  # type: ignore
    import torch

    artifact = json.loads(artifact_path.read_text())
    artifact.pop("similarityMapping", None)
    companies = artifact.get("companies") or []
    for company in companies:
        company.pop("similarityVersion", None)
    selected = companies[:limit] if limit else companies
    texts = [company_text(company) for company in selected]

    resolved_device = device
    if device == "auto":
        resolved_device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = GLiNER.from_pretrained(model_name).to(resolved_device)
    predictions: list[list[dict[str, Any]]] = []
    for start in range(0, len(texts), chunk_size):
        chunk = texts[start : start + chunk_size]
        predictions.extend(
            model.inference(
                chunk,
                list(DEFAULT_LABELS),
                threshold=threshold,
                batch_size=batch_size,
            )
        )
        print(
            f"company entities: inferred {min(start + chunk_size, len(texts))}/{len(texts)} "
            f"on {resolved_device}",
            flush=True,
        )

    enriched_count = 0
    entity_count = 0
    for company, company_predictions in zip(selected, predictions, strict=True):
        entities = normalize_predictions(company_predictions)
        company["entities"] = entities
        if entities:
            enriched_count += 1
            entity_count += len(entities)

    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    artifact["entityExtraction"] = {
        "generatedAt": generated_at,
        "model": model_name,
        "labels": list(DEFAULT_LABELS),
        "threshold": threshold,
        "processedCompanyCount": len(selected),
        "enrichedCompanyCount": enriched_count,
        "entityCount": entity_count,
        "complete": len(selected) == len(companies),
    }

    temporary_path = artifact_path.with_suffix(".json.tmp")
    temporary_path.write_text(json.dumps(artifact, indent=2, ensure_ascii=False) + "\n")
    temporary_path.replace(artifact_path)
    print(
        f"company entities: {enriched_count}/{len(selected)} companies, "
        f"{entity_count} facets, model={model_name}, device={resolved_device}"
    )
    return enriched_count


def main() -> None:
    parser = argparse.ArgumentParser(description="Enrich company universe with GLiNER facets")
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--batch-size", type=int, default=24)
    parser.add_argument("--chunk-size", type=int, default=256)
    parser.add_argument("--device", default="auto", choices=("auto", "cpu", "mps"))
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    enrich(
        artifact_path=args.artifact,
        model_name=args.model,
        threshold=args.threshold,
        batch_size=args.batch_size,
        chunk_size=args.chunk_size,
        device=args.device,
        limit=args.limit,
    )


if __name__ == "__main__":
    main()
