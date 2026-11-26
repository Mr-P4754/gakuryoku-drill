#!/usr/bin/env python3
"""
ローカル静的JSON（data/*.json）の内容を Googleスプレッドシートへ安全に同期するスクリプト。
- data/meta.json に登録された全学年（または --grade 指定学年）のシートを自動作成・同期
- 既存の「学習ログ」および「マスタ_学校認証」のデータは絶対に上書きしない安全設計
"""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
SPREADSHEET_ID = "1Au59gUt-qiAPspIrg7ZcQMB5UiQ-1HMUrAXHqsTA2dY"

Q_HEADERS = [
    "problem_id", "unit_code", "unit_order", "unit_name", "source_type",
    "difficulty", "group_id", "context_text", "display_mode", "image_path",
    "question_text", "question_type", "choices", "answer", "accepted_answers",
    "unit_label", "hint", "explanation", "explanation_image", "is_active"
]

GUIDE_HEADERS = [
    "unit_code", "subject", "unit_order", "unit_name",
    "goal", "key_points", "example_text", "guide_image"
]

MASTER_HEADERS = [
    "grade", "subject", "subject_key", "sheet_name", "guide_sheet",
    "data_file", "guide_file", "theme_color", "theme_bg",
    "display_order", "is_active"
]

LOG_HEADERS = [
    "logged_at", "school_code", "grade", "class_name", "student_no",
    "student_key", "subject", "unit_code", "unit_name", "mode",
    "score", "total", "accuracy_pct", "self_check_count",
    "wrong_ids", "duration_sec", "device_id"
]

AUTH_HEADERS = [
    "school_code", "school_label", "password", "is_active", "memo"
]

SUBJECT_HEADER_BG = {
    "国語": "#B91C1C",
    "社会": "#B45309",
    "算数": "#1D4ED8",
    "理科": "#047857",
}


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_sheets():
    res = subprocess.run(
        ["gsheets", "readonly", "list-sheets", SPREADSHEET_ID, "--json"],
        capture_output=True, text=True, check=True
    )
    return json.loads(res.stdout)


def ensure_sheet_exists(sheet_name: str, existing_titles: set):
    if sheet_name in existing_titles:
        return False
    print(f"[SYNC] Creating new sheet: {sheet_name}")
    subprocess.run(
        ["gsheets", "mutate", "add-sheet", SPREADSHEET_ID, "--title", sheet_name],
        check=True
    )
    existing_titles.add(sheet_name)
    return True


def run_batch(ops):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tf:
        json.dump(ops, tf, ensure_ascii=False)
        tmp_path = tf.name
    try:
        res = subprocess.run(
            ["gsheets", "mutate", "batch", SPREADSHEET_ID, "-f", tmp_path],
            capture_output=True, text=True, check=True
        )
        print(res.stdout.strip())
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def to_cell(v):
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if v is None:
        return ""
    return v


def write_sheet_chunked(sheet_name: str, headers: list, rows: list, chunk_size: int = 150):
    all_data = [headers] + [[to_cell(r.get(h, "")) for h in headers] for r in rows]
    print(f"[SYNC] Writing {sheet_name}: {len(rows)} data rows...")
    for start in range(0, len(all_data), chunk_size):
        chunk = all_data[start:start + chunk_size]
        row_num = start + 1
        ops = [{
            "op": "write",
            "range": f"'{sheet_name}'!A{row_num}",
            "data": chunk
        }]
        run_batch(ops)


def setup_dashboard_sheet(existing_titles: set):
    ensure_sheet_exists("集計_クラス進捗", existing_titles)
    print("[SYNC] Setting up 集計_クラス進捗 formulas (multi-grade ready)...")
    rows = [
        ["標準学力調査対策 デジタルドリル 教員用集計ダッシュボード"] + [""] * 15,
        ["※ 学習ログシートに児童の結果が送信されると学年・教科・単元・児童ごとに自動集計されます。"] + [""] * 15,
        [""] * 16,
        [
            "【1】学年・教科・単元別 実施状況（平均正答率・延べ挑戦数）",
            "", "", "", "", "", "", "", "",
            "【2】児童別（学校名_学年_組_番号）取り組み集計",
            "", "", "", "", "", ""
        ],
        [
            "学年", "教科", "単元コード", "単元名", "延べ挑戦数", "平均正答率(%)", "最高正答率(%)", "最低正答率(%)",
            "",
            "児童キー(学校_学年_組_番号)", "学校名", "学年", "組", "出席番号", "延べ実施回数", "平均正答率(%)"
        ],
        [
            "=IFERROR(QUERY('学習ログ'!A2:Q,\"select C,G,H,I,count(K),avg(M),max(M),min(M) where G is not null group by C,G,H,I order by C,G,H label count(K) '', avg(M) '', max(M) '', min(M) ''\",0),\"データ待機中\")",
            "", "", "", "", "", "", "",
            "",
            "=IFERROR(QUERY('学習ログ'!A2:Q,\"select F,B,C,D,E,count(K),avg(M) where F is not null group by F,B,C,D,E order by B,C,D,E label count(K) '', avg(M) ''\",0),\"データ待機中\")",
            "", "", "", "", "", ""
        ],
    ]
    run_batch([{"op": "write", "range": "'集計_クラス進捗'!A1", "data": rows}])


def ensure_log_sheet(existing_titles: set):
    if "学習ログ" in existing_titles:
        print("[SYNC] 学習ログ already exists; preserving all existing student logs.")
        return
    ensure_sheet_exists("学習ログ", existing_titles)
    write_sheet_chunked("学習ログ", LOG_HEADERS, [])


def ensure_auth_sheet(existing_titles: set):
    if "マスタ_学校認証" in existing_titles:
        print("[SYNC] マスタ_学校認証 already exists; keeping existing passwords intact.")
        return
    ensure_sheet_exists("マスタ_学校認証", existing_titles)
    rows = [
        AUTH_HEADERS,
        ["hino", "hino校", "hino2026", "TRUE", "仮パスワードです。運用前に任意のパスワードへ変更してください（sha256:ハッシュも可）"],
    ]
    run_batch([{"op": "write", "range": "'マスタ_学校認証'!A1", "data": rows}])


def format_headers(meta: dict, only_sheets: set | None = None):
    sheets = list_sheets()
    header_cols = {
        "マスタ_教科一覧": (11, "#1E40AF"),
        "学習ログ": (17, "#334155"),
        "マスタ_学校認証": (5, "#0F172A"),
    }
    for s in meta.get("subjects", []):
        g_sheet = s.get("guide_sheet")
        if g_sheet:
            header_cols[g_sheet] = (8, "#0F766E")
        q_sheet = s.get("sheet_name")
        if q_sheet:
            header_cols[q_sheet] = (20, SUBJECT_HEADER_BG.get(s.get("subject", ""), "#1D4ED8"))

    for s in sheets:
        title = s.get("title") or s.get("Title")
        sid = s.get("sheetId") if "sheetId" in s else s.get("id", s.get("ID"))
        if title not in header_cols or sid is None:
            continue
        if only_sheets is not None and title not in only_sheets:
            continue
        cols, bg = header_cols[title]
        subprocess.run([
            "gsheets", "mutate", "format", SPREADSHEET_ID,
            "--sheet-id", str(sid),
            "--start-row", "0", "--end-row", "1",
            "--start-col", "0", "--end-col", str(cols),
            "--bold", "--bg-color", bg, "--fg-color", "#FFFFFF", "--wrap"
        ], check=True)
        subprocess.run([
            "gsheets", "mutate", "freeze", SPREADSHEET_ID,
            "--sheet-id", str(sid), "--rows", "1"
        ], check=True)
    print("[FORMAT] Header styling and freeze completed!")


def main():
    parser = argparse.ArgumentParser(description="Sync static drill JSONs to Google Sheets safely.")
    parser.add_argument("--grade", action="append", help="Sync only specified grade(s), e.g. --grade 3年 (always updates マスタ_教科一覧)")
    parser.add_argument("--skip-dashboard", action="store_true", help="Skip rewriting 集計_クラス進捗 formulas")
    args = parser.parse_args()

    meta = load_json(DATA_DIR / "meta.json")
    existing_titles = {s.get("title") or s.get("Title") for s in list_sheets()}
    target_grades = set(args.grade) if args.grade else None
    touched_sheets = {"マスタ_教科一覧"}

    ensure_sheet_exists("マスタ_教科一覧", existing_titles)
    write_sheet_chunked("マスタ_教科一覧", MASTER_HEADERS, meta["subjects"])

    guides_done = set()
    for s in meta.get("subjects", []):
        grade = s.get("grade")
        if target_grades and grade not in target_grades:
            continue

        guide_sheet = s.get("guide_sheet")
        guide_file = s.get("guide_file")
        if guide_sheet and guide_file and guide_sheet not in guides_done:
            ensure_sheet_exists(guide_sheet, existing_titles)
            guides = load_json(ROOT / guide_file)
            write_sheet_chunked(guide_sheet, GUIDE_HEADERS, guides)
            guides_done.add(guide_sheet)
            touched_sheets.add(guide_sheet)

        sheet_name = s.get("sheet_name")
        data_file = s.get("data_file")
        if sheet_name and data_file:
            ensure_sheet_exists(sheet_name, existing_titles)
            rows = load_json(ROOT / data_file)
            write_sheet_chunked(sheet_name, Q_HEADERS, rows)
            touched_sheets.add(sheet_name)

    ensure_log_sheet(existing_titles)
    ensure_auth_sheet(existing_titles)
    if not args.skip_dashboard:
        setup_dashboard_sheet(existing_titles)

    format_headers(meta, only_sheets=touched_sheets if target_grades else None)
    print("\n[ALL DONE] Googleスプレッドシートへの同期が完了しました！")


if __name__ == "__main__":
    main()
