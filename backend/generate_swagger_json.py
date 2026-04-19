"""Generate a static Swagger/OpenAPI JSON spec for DupliDetect.

This exports the same schema that FastAPI serves at `/openapi.json`.

Usage (PowerShell):
  cd backend
  python generate_swagger_json.py

Output:
  backend/swagger.json
"""

from __future__ import annotations

import json
from pathlib import Path


def main() -> int:
    # Importing app is enough to build the OpenAPI schema.
    from main import app

    spec = app.openapi()
    out_path = Path(__file__).with_name("swagger.json")
    out_path.write_text(json.dumps(spec, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
