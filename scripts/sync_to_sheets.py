#!/usr/bin/env python3
"""
ローカル静的JSON（data/*.json）の内容を Googleスプレッドシートへ一括反映するスクリプト
gsheets CLI (mutate batch / mutate format / mutate freeze) を使用します。
"""
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


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


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


def setup_dashboard_sheet():
    print("[SYNC] Setting up 集計_クラス進捗 formulas (multi-grade ready)...")
    # A1:P8 を一括で整形上書き（旧レイアウト残骸も消去）
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
    run_batch([
        {"op": "write", "range": "'集計_クラス進捗'!A1", "data": rows},
    ])


AUTH_HEADERS = [
    "school_code", "school_label", "password", "is_active", "memo"
]


def ensure_auth_sheet():
    res = subprocess.run(
        ["gsheets", "readonly", "list-sheets", SPREADSHEET_ID, "--json"],
        capture_output=True, text=True, check=True
    )
    sheets = json.loads(res.stdout)
    titles = {s.get("title") or s.get("Title") for s in sheets}
    if "マスタ_学校認証" in titles:
        print("[SYNC] マスタ_学校認証 already exists; keeping existing passwords intact.")
        return
    print("[SYNC] Creating マスタ_学校認証 sheet with initial template row...")
    subprocess.run(
        ["gsheets", "mutate", "add-sheet", SPREADSHEET_ID, "--title", "マスタ_学校認証"],
        check=True
    )
    rows = [
        AUTH_HEADERS,
        ["hino", "hino校", "hino2026", "TRUE", "仮パスワードです。運用前に任意のパスワードへ変更してください（sha256:ハッシュも可）"],
    ]
    run_batch([{"op": "write", "range": "'マスタ_学校認証'!A1", "data": rows}])


def format_headers():
    res = subprocess.run(
        ["gsheets", "readonly", "list-sheets", SPREADSHEET_ID, "--json"],
        capture_output=True, text=True, check=True
    )
    sheets = json.loads(res.stdout)
    header_cols = {
        "マスタ_教科一覧": (11, "#1E40AF"),
        "4年_単元ガイド": (8, "#0F766E"),
        "4年_国語": (20, "#B91C1C"),
        "4年_社会": (20, "#B45309"),
        "4年_算数": (20, "#1D4ED8"),
        "4年_理科": (20, "#047857"),
        "学習ログ": (17, "#334155"),
        "集計_クラス進捗": (14, "#1E293B"),
        "マスタ_学校認証": (5, "#0F172A"),
    }
    for s in sheets:
        title = s.get("title") or s.get("Title")
        sid = s.get("sheetId") if "sheetId" in s else s.get("id", s.get("ID"))
        if title not in header_cols or sid is None:
            continue
        cols, bg = header_cols[title]
        if title != "集計_クラス進捗":
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
    meta = load_json(DATA_DIR / "meta.json")
    write_sheet_chunked("マスタ_教科一覧", MASTER_HEADERS, meta["subjects"])

    guides = load_json(DATA_DIR / "4年_単元ガイド.json")
    write_sheet_chunked("4年_単元ガイド", GUIDE_HEADERS, guides)

    for sheet_name in ["4年_国語", "4年_社会", "4年_算数", "4年_理科"]:
        rows = load_json(DATA_DIR / f"{sheet_name}.json")
        write_sheet_chunked(sheet_name, Q_HEADERS, rows)

    write_sheet_chunked("学習ログ", LOG_HEADERS, [])
    setup_dashboard_sheet()
    ensure_auth_sheet()
    format_headers()
    print("\n[ALL DONE] Googleスプレッドシートへの全量同期が完了しました！")


if __name__ == "__main__":
    main()
