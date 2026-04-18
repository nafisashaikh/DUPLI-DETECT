"""Offline evaluation for DupliDetect.

Computes basic classification metrics (precision/recall/F1) for a labeled
set of text pairs across languages.

Usage (PowerShell):
  cd backend
  python evaluate.py --pairs eval_pairs.jsonl --threshold 0.70

Input JSONL format (one per line):
  {"a": "Apple", "b": "りんご", "is_duplicate": true}
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Metrics:
    tp: int = 0
    fp: int = 0
    tn: int = 0
    fn: int = 0

    def precision(self) -> float:
        d = self.tp + self.fp
        return (self.tp / d) if d else 0.0

    def recall(self) -> float:
        d = self.tp + self.fn
        return (self.tp / d) if d else 0.0

    def f1(self) -> float:
        p = self.precision()
        r = self.recall()
        return (2 * p * r / (p + r)) if (p + r) else 0.0


def load_pairs(path: Path):
    pairs = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            a = str(obj.get("a", ""))
            b = str(obj.get("b", ""))
            y = bool(obj.get("is_duplicate", False))
            if a.strip() and b.strip():
                pairs.append((a, b, y))
    return pairs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", type=Path, default=Path("eval_pairs.jsonl"))
    ap.add_argument("--threshold", type=float, default=0.70)
    ap.add_argument(
        "--sweep",
        action="store_true",
        help="Sweep thresholds from 0.30..0.90 and recommend best F1.",
    )
    ap.add_argument(
        "--model",
        type=str,
        default=None,
        help="Override MODEL_NAME for this run (e.g. sentence-transformers/LaBSE).",
    )
    args = ap.parse_args()

    if args.model:
        os.environ["MODEL_NAME"] = args.model

    from main import embed, cosine_similarity

    pairs = load_pairs(args.pairs)
    if not pairs:
        print("No pairs found.")
        return 2

    def eval_at(th: float, verbose: bool) -> Metrics:
        m = Metrics()
        for a, b, y in pairs:
            sim = cosine_similarity(embed(a), embed(b))
            yhat = sim >= th

            if y and yhat:
                m.tp += 1
            elif (not y) and yhat:
                m.fp += 1
            elif (not y) and (not yhat):
                m.tn += 1
            else:
                m.fn += 1

            if verbose:
                print(
                    f"sim={sim*100:6.2f}%  pred={str(yhat):5}  gold={str(y):5}  ::  {a!r}  <->  {b!r}"
                )
        return m

    if args.sweep:
        best_th = None
        best_m = None
        for i in range(30, 91, 2):
            th = i / 100
            m = eval_at(th, verbose=False)
            if best_m is None or m.f1() > best_m.f1():
                best_th = th
                best_m = m

        assert best_th is not None and best_m is not None
        print("--- Sweep ---")
        print(f"best_threshold={best_th:.2f}  precision={best_m.precision():.3f} recall={best_m.recall():.3f} f1={best_m.f1():.3f}")
        print(f"TP={best_m.tp} FP={best_m.fp} TN={best_m.tn} FN={best_m.fn}")
        print("\n(Re-run without --sweep to see per-pair details.)")
        return 0

    m = eval_at(args.threshold, verbose=True)

    print("\n--- Summary ---")
    print(f"pairs: {len(pairs)}")
    print(f"threshold: {args.threshold:.2f}")
    print(f"TP={m.tp} FP={m.fp} TN={m.tn} FN={m.fn}")
    print(f"precision={m.precision():.3f} recall={m.recall():.3f} f1={m.f1():.3f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
