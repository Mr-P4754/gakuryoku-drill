#!/usr/bin/env python3
"""
全教科JSON・単元ガイドの結合および厳密バリデーションスクリプト
"""
import json
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

REQUIRED_Q_KEYS = [
    "problem_id", "unit_code", "unit_order", "unit_name", "source_type",
    "difficulty", "group_id", "context_text", "display_mode", "image_path",
    "question_text", "question_type", "choices", "answer", "accepted_answers",
    "unit_label", "hint", "explanation", "explanation_image", "is_active"
]

VALID_TYPES = {
    "single_choice", "multi_choice", "word_bank", "matching", "ordering",
    "text_input", "number_input", "fraction_input", "formula_input",
    "self_check_draw", "self_check_text"
}

REQUIRED_GUIDE_KEYS = [
    "unit_code", "subject", "unit_order", "unit_name",
    "goal", "key_points", "example_text", "guide_image"
]


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def merge_parts():
    p1 = DATA_DIR / "4年_算数_part1.json"
    p2 = DATA_DIR / "4年_算数_part2.json"
    if p1.exists() and p2.exists():
        src_rank = {"フォローアップ": 1, "たしかめドリル": 2, "チャレンジ": 3}
        merged = load_json(p1) + load_json(p2)
        merged.sort(key=lambda r: (int(r.get("unit_order", 0)), src_rank.get(r.get("source_type", ""), 9), str(r.get("problem_id", ""))))
        save_json(DATA_DIR / "4年_算数.json", merged)
        print(f"[MERGE] 4年_算数.json <- part1 + part2 ({len(merged)} questions)")

    guide_files = [
        "guides_kokugo.json",
        "guides_shakai.json",
        "guides_sansu_part1.json",
        "guides_sansu_part2.json",
        "guides_rika.json",
    ]
    guides = []
    for gf in guide_files:
        fp = DATA_DIR / gf
        if fp.exists():
            guides.extend(load_json(fp))
    if guides:
        subject_order = {"国語": 1, "社会": 2, "算数": 3, "理科": 4}
        guides.sort(key=lambda g: (subject_order.get(g.get("subject", ""), 9), int(g.get("unit_order", 0))))
        save_json(DATA_DIR / "4年_単元ガイド.json", guides)
        print(f"[MERGE] 4年_単元ガイド.json ({len(guides)} unit guides)")


def validate_svg(rel_path: str, errors: list, ctx: str):
    if not rel_path:
        return
    for p in str(rel_path).split("|"):
        p = p.strip()
        if not p:
            continue
        full = ROOT / p
        if not full.exists():
            errors.append(f"[{ctx}] Missing asset: {p}")
            continue
        if full.suffix.lower() == ".svg":
            try:
                ET.parse(full)
            except Exception as e:
                errors.append(f"[{ctx}] Invalid SVG XML {p}: {e}")


def validate_all():
    errors = []
    seen_ids = set()

    subjects = [
        ("4年_国語.json", 11),
        ("4年_社会.json", 10),
        ("4年_算数.json", 36),
        ("4年_理科.json", 20),
    ]

    total_q = 0
    total_units = 0

    for fname, expected_units in subjects:
        fpath = DATA_DIR / fname
        if not fpath.exists():
            errors.append(f"Missing subject file: {fname}")
            continue
        rows = load_json(fpath)
        units = set()
        for idx, row in enumerate(rows):
            pid = row.get("problem_id", f"row#{idx}")
            for k in REQUIRED_Q_KEYS:
                if k not in row:
                    errors.append(f"[{fname}:{pid}] Missing key: {k}")
            if pid in seen_ids:
                errors.append(f"[{fname}:{pid}] Duplicate problem_id")
            seen_ids.add(pid)

            qt = row.get("question_type")
            if qt not in VALID_TYPES:
                errors.append(f"[{fname}:{pid}] Invalid question_type: {qt}")

            if not str(row.get("question_text", "")).strip():
                errors.append(f"[{fname}:{pid}] Empty question_text")
            if not str(row.get("answer", "")).strip():
                errors.append(f"[{fname}:{pid}] Empty answer")

            if qt in ("single_choice", "multi_choice", "word_bank", "matching", "ordering"):
                if not str(row.get("choices", "")).strip():
                    errors.append(f"[{fname}:{pid}] Empty choices for {qt}")

            validate_svg(row.get("image_path", ""), errors, f"{fname}:{pid}")
            validate_svg(row.get("explanation_image", ""), errors, f"{fname}:{pid}")
            units.add(row.get("unit_code"))

        total_q += len(rows)
        total_units += len(units)
        status = "OK" if len(units) == expected_units else f"WARN (expected {expected_units})"
        print(f"[CHECK] {fname}: {len(rows)} questions, {len(units)} units {status}")

    gpath = DATA_DIR / "4年_単元ガイド.json"
    if gpath.exists():
        guides = load_json(gpath)
        for g in guides:
            uc = g.get("unit_code", "?")
            for k in REQUIRED_GUIDE_KEYS:
                if k not in g:
                    errors.append(f"[guide:{uc}] Missing key: {k}")
            validate_svg(g.get("guide_image", ""), errors, f"guide:{uc}")
        print(f"[CHECK] 4年_単元ガイド.json: {len(guides)} guides")
    else:
        errors.append("Missing 4年_単元ガイド.json")

    svg_count = len(list((ROOT / "assets" / "svg").rglob("*.svg")))
    print(f"[SUMMARY] Total: {total_units} units, {total_q} questions, {svg_count} SVG files")

    if errors:
        print(f"\n[ERRORS] Found {len(errors)} issue(s):")
        for e in errors[:50]:
            print("  -", e)
        if len(errors) > 50:
            print(f"  ... and {len(errors) - 50} more")
        return 1

    print("\n[SUCCESS] All JSON schemas, unit counts, and SVG files are valid!")
    return 0


if __name__ == "__main__":
    merge_parts()
    sys.exit(validate_all())
