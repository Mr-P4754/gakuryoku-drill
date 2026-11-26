#!/usr/bin/env python3
"""
全学年・全教科JSONおよび単元ガイドの結合＆厳密バリデーションスクリプト
"""
import json
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

EXPECTED_UNITS_BY_SHEET = {
    "3年_国語": 11,
    "3年_社会": 12,
    "3年_算数": 23,
    "3年_理科": 15,
    "4年_国語": 11,
    "4年_社会": 10,
    "4年_算数": 36,
    "4年_理科": 20,
    "5年_国語": 11,
    "5年_社会": 12,
    "5年_算数": 29,
    "5年_理科": 18,
}


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def merge_parts():
    src_rank = {"フォローアップ": 1, "たしかめドリル": 2, "チャレンジ": 3}
    subject_order = {"国語": 1, "社会": 2, "算数": 3, "理科": 4}

    # 算数 part1 + part2 結合（3年・4年・5年共通）
    for grade in ["3年", "4年", "5年"]:
        p1 = DATA_DIR / f"{grade}_算数_part1.json"
        p2 = DATA_DIR / f"{grade}_算数_part2.json"
        if p1.exists() and p2.exists():
            merged = load_json(p1) + load_json(p2)
            merged.sort(key=lambda r: (
                int(r.get("unit_order", 0)),
                src_rank.get(r.get("source_type", ""), 9),
                str(r.get("problem_id", ""))
            ))
            save_json(DATA_DIR / f"{grade}_算数.json", merged)
            print(f"[MERGE] {grade}_算数.json <- part1 + part2 ({len(merged)} questions)")

    # 4年 単元ガイド結合
    g4_files = [
        "guides_kokugo.json",
        "guides_shakai.json",
        "guides_sansu_part1.json",
        "guides_sansu_part2.json",
        "guides_rika.json",
    ]
    g4 = []
    for gf in g4_files:
        fp = DATA_DIR / gf
        if fp.exists():
            g4.extend(load_json(fp))
    if g4:
        g4.sort(key=lambda g: (subject_order.get(g.get("subject", ""), 9), int(g.get("unit_order", 0))))
        save_json(DATA_DIR / "4年_単元ガイド.json", g4)
        print(f"[MERGE] 4年_単元ガイド.json ({len(g4)} unit guides)")

    # 3年・5年 単元ガイド結合
    for gnum, gname in [("3", "3年"), ("5", "5年")]:
        g_files = [
            f"guides_{gnum}_kokugo.json",
            f"guides_{gnum}_shakai.json",
            f"guides_{gnum}_sansu_part1.json",
            f"guides_{gnum}_sansu_part2.json",
            f"guides_{gnum}_rika.json",
        ]
        glist = []
        for gf in g_files:
            fp = DATA_DIR / gf
            if fp.exists():
                glist.extend(load_json(fp))
        if glist:
            glist.sort(key=lambda g: (subject_order.get(g.get("subject", ""), 9), int(g.get("unit_order", 0))))
            save_json(DATA_DIR / f"{gname}_単元ガイド.json", glist)
            print(f"[MERGE] {gname}_単元ガイド.json ({len(glist)} unit guides)")


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

    meta = load_json(DATA_DIR / "meta.json")
    subjects = [s for s in meta.get("subjects", []) if s.get("is_active") is not False]

    total_q = 0
    total_units = 0
    guide_files_seen = set()

    for s in subjects:
        sheet_name = s["sheet_name"]
        rel_file = s.get("data_file") or f"data/{sheet_name}.json"
        fpath = ROOT / rel_file
        if not fpath.exists():
            errors.append(f"Missing subject file: {rel_file}")
            continue
        rows = load_json(fpath)
        units = set()
        for idx, row in enumerate(rows):
            pid = row.get("problem_id", f"row#{idx}")
            for k in REQUIRED_Q_KEYS:
                if k not in row:
                    errors.append(f"[{sheet_name}:{pid}] Missing key: {k}")
            if pid in seen_ids:
                errors.append(f"[{sheet_name}:{pid}] Duplicate problem_id")
            seen_ids.add(pid)

            qt = row.get("question_type")
            if qt not in VALID_TYPES:
                errors.append(f"[{sheet_name}:{pid}] Invalid question_type: {qt}")

            if not str(row.get("question_text", "")).strip():
                errors.append(f"[{sheet_name}:{pid}] Empty question_text")
            if not str(row.get("answer", "")).strip():
                errors.append(f"[{sheet_name}:{pid}] Empty answer")

            if qt in ("single_choice", "multi_choice", "word_bank", "matching", "ordering"):
                if not str(row.get("choices", "")).strip():
                    errors.append(f"[{sheet_name}:{pid}] Empty choices for {qt}")

            validate_svg(row.get("image_path", ""), errors, f"{sheet_name}:{pid}")
            validate_svg(row.get("explanation_image", ""), errors, f"{sheet_name}:{pid}")
            units.add(row.get("unit_code"))

        total_q += len(rows)
        total_units += len(units)
        expected = EXPECTED_UNITS_BY_SHEET.get(sheet_name)
        if expected is not None and len(units) != expected:
            errors.append(f"[{sheet_name}] Unit count mismatch: got {len(units)}, expected {expected}")
        status = "OK" if (expected is None or len(units) == expected) else f"NG (expected {expected})"
        print(f"[CHECK] {sheet_name}: {len(rows)} questions, {len(units)} units {status}")

        if s.get("guide_file"):
            guide_files_seen.add((s["grade"], s["guide_file"]))

    for grade, rel_gfile in sorted(guide_files_seen):
        gpath = ROOT / rel_gfile
        if gpath.exists():
            guides = load_json(gpath)
            for g in guides:
                uc = g.get("unit_code", "?")
                for k in REQUIRED_GUIDE_KEYS:
                    if k not in g:
                        errors.append(f"[{grade} guide:{uc}] Missing key: {k}")
                validate_svg(g.get("guide_image", ""), errors, f"{grade} guide:{uc}")
            print(f"[CHECK] {rel_gfile}: {len(guides)} guides")
        else:
            errors.append(f"Missing guide file: {rel_gfile}")

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
