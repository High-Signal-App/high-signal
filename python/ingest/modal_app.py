"""Modal deploy: scheduled ingest + scoring."""

from __future__ import annotations

import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_pyproject("pyproject.toml")
    .env({"PYTHONPATH": "/root"})
    .add_local_dir("src/high_signal_ingest", "/root/high_signal_ingest")
)

app = modal.App("high-signal-ingest")
# `huggingface` secret provides HF_TOKEN — generator routes to HF Inference Router
# when AI_API_KEY/AI_BASE_URL are not explicitly set in `high-signal`.
secrets = [
    modal.Secret.from_name("high-signal"),
    modal.Secret.from_name("huggingface"),
]


# Daily crons migrated to GitHub Actions workflows (.github/workflows/cron-*.yml)
# — public repo gets unlimited GH minutes, simpler secret model.
# Modal kept here only for ad-hoc backfills via `modal run` CLI when GH Actions
# 6h job limit is too tight.


@app.function(image=image, timeout=600, secrets=secrets)
def manual_ingest(source: str = "all", days: int = 1) -> dict:
    from high_signal_ingest.pipeline import run

    return run(source, days)  # type: ignore[arg-type]


@app.function(image=image, timeout=600, secrets=secrets)
def manual_score() -> dict:
    from high_signal_ingest.score.runner import run

    return run()


@app.function(image=image, timeout=86400, secrets=secrets)
def manual_backfill(start: str, end: str, sources: str = "gdelt", chunk_days: int = 7) -> dict:
    """Run historical replay over a date window.

    Example:
      modal run modal_app.py::manual_backfill --start 2026-03-26 --end 2026-04-26 --sources gdelt
    """
    from datetime import datetime, timezone
    from high_signal_ingest.backfill import run as bf_run

    s = datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
    e = datetime.fromisoformat(end).replace(tzinfo=timezone.utc)
    return bf_run(s, e, [src.strip() for src in sources.split(",") if src.strip()], chunk_days)


# Manual triggers (CLI):
#   uv run modal run modal_app.py::manual_ingest --source all --days 1
#   uv run modal run modal_app.py::manual_score
# Web endpoints intentionally omitted — workspace caps at 8; daily crons above
# fire internally so Worker dispatch is unnecessary.

if __name__ == "__main__":
    with app.run():
        print(manual_ingest.remote())
