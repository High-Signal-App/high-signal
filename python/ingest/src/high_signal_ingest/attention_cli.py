"""Command-line entry point shared by attention-source collectors."""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Callable
from typing import Any


def run_attention_collector(
    description: str, collector: Callable[[str, str], dict[str, Any]]
) -> None:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--api-base", default=os.environ.get("API_BASE"))
    parser.add_argument("--admin-token", default=os.environ.get("ADMIN_TOKEN"))
    args = parser.parse_args()
    if not args.api_base or not args.admin_token:
        parser.error("API_BASE and ADMIN_TOKEN are required")
    print(json.dumps(collector(args.api_base, args.admin_token), sort_keys=True))
