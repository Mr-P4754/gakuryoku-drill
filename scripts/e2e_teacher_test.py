#!/usr/bin/env python3
"""
先生用：取組状況確認（歯車モーダル→認証→4ビュー→1〜40番トグル→詳細/問題プレビュー→ログアウト）
Playwright E2E テスト＆スクリーンショット検証スクリプト
"""
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOT_DIR = Path("/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/1a490842-3849-4a02-8baa-7b383741c3b2/scratch")
SHOT_DIR.mkdir(parents=True, exist_ok=True)


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass


MOCK_LOGS = [
    {
        "logged_at": "2026-11-25 10:30:00",
        "school_code": "hino",
        "grade": "4年",
        "class_name": "1組",
        "student_no": 16,
        "student_key": "hino_4年_1組_16",
        "subject": "国語",
        "unit_code": "P5JA1_007",
        "unit_name": "ことわざ",
        "mode": "unit",
        "score": 11,
        "total": 12,
        "accuracy_pct": 92,
        "self_check_count": 0,
        "wrong_ids": "4JA_007_D_01",
        "duration_sec": 115,
    },
    {
        "logged_at": "2026-11-25 09:50:00",
        "school_code": "hino",
        "grade": "4年",
        "class_name": "1組",
        "student_no": 16,
        "student_key": "hino_4年_1組_16",
        "subject": "国語",
        "unit_code": "P5JA1_007",
        "unit_name": "ことわざ",
        "mode": "unit",
        "score": 7,
        "total": 12,
        "accuracy_pct": 58,
        "self_check_count": 0,
        "wrong_ids": "4JA_007_D_01,4JA_007_D_02",
        "duration_sec": 140,
    },
    {
        "logged_at": "2026-11-25 09:20:00",
        "school_code": "hino",
        "grade": "4年",
        "class_name": "1組",
        "student_no": 3,
        "student_key": "hino_4年_1組_03",
        "subject": "国語",
        "unit_code": "P5JA1_001",
        "unit_name": "漢字を読む",
        "mode": "unit",
        "score": 15,
        "total": 38,
        "accuracy_pct": 39,
        "self_check_count": 0,
        "wrong_ids": "4JA_001_F_01",
        "duration_sec": 240,
    },
    {
        "logged_at": "2026-11-24 15:10:00",
        "school_code": "hino",
        "grade": "4年",
        "class_name": "2組",
        "student_no": 7,
        "student_key": "hino_4年_2組_07",
        "subject": "算数",
        "unit_code": "P5MA1_005",
        "unit_name": "わり算",
        "mode": "unit",
        "score": 11,
        "total": 13,
        "accuracy_pct": 85,
        "self_check_count": 0,
        "wrong_ids": "4MA_005_D_01",
        "duration_sec": 190,
    },
]


def run():
    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    base_url = f"http://127.0.0.1:{port}"

    console_errors = []
    api_calls = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(viewport={"width": 1280, "height": 840})
            page = context.new_page()

            def handle_gas(route):
                req = route.request
                if req.method == "POST":
                    body = json.loads(req.post_data or "{}")
                    api_calls.append(body)
                    action = body.get("action")
                    assert body.get("logs") == [], f"Expected safety logs:[] on teacher API, got {body}"
                    if action == "teacher_auth":
                        if body.get("school_code") == "hino" and body.get("password") == "hino2026":
                            route.fulfill(
                                status=200,
                                content_type="application/json",
                                body=json.dumps({
                                    "status": "ok",
                                    "token": "mock-token-12345",
                                    "expires_in_sec": 1800,
                                    "school_code": "hino",
                                    "school_label": "hino校",
                                    "fetched_at": "2026-11-25T10:35:00Z",
                                    "total_count": len(MOCK_LOGS),
                                    "truncated": False,
                                    "logs": MOCK_LOGS,
                                }, ensure_ascii=False),
                            )
                        else:
                            route.fulfill(
                                status=200,
                                content_type="application/json",
                                body=json.dumps({
                                    "status": "error",
                                    "code": "AUTH_FAILED",
                                    "message": "学校名またはパスワードが正しくありません。",
                                }, ensure_ascii=False),
                            )
                        return
                    if action == "teacher_logs":
                        route.fulfill(
                            status=200,
                            content_type="application/json",
                            body=json.dumps({
                                "status": "ok",
                                "expires_in_sec": 1800,
                                "school_code": "hino",
                                "school_label": "hino校",
                                "fetched_at": "2026-11-25T10:40:00Z",
                                "total_count": len(MOCK_LOGS),
                                "truncated": False,
                                "logs": MOCK_LOGS,
                            }, ensure_ascii=False),
                        )
                        return
                    if action == "teacher_logout":
                        route.fulfill(status=200, content_type="application/json", body='{"status":"ok"}')
                        return
                route.fulfill(status=200, content_type="application/json", body='{"status":"noop"}')

            page.route("**/script.google.com/**", handle_gas)
            page.on("console", lambda m: console_errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
            page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))

            page.goto(base_url, wait_until="networkidle")
            # 初回プロフィール登録モーダルをスキップ
            if page.locator("#profile-modal:not(.hidden)").is_visible():
                page.click("#prof-skip-btn")

            # 1. 歯車ボタン → 設定モーダル内の「取組状況を確認する」ボタンを確認
            page.click("#settings-btn")
            page.wait_for_selector("#settings-modal:not(.hidden)")
            assert page.locator("#open-teacher-btn").is_visible()
            page.screenshot(path=str(SHOT_DIR / "teacher_settings_modal.png"))

            # 2. 認証モーダルを開き、誤パスワードをテスト
            page.click("#open-teacher-btn")
            page.wait_for_selector("#teacher-auth-modal:not(.hidden)")
            page.fill("#teacher-school-input", "hino")
            page.fill("#teacher-password-input", "wrongpass")
            page.click("#teacher-auth-submit")
            page.wait_for_selector("#teacher-auth-error:not(.hidden)")
            assert "正しくありません" in page.locator("#teacher-auth-error").inner_text()
            # localStorage にパスワードやトークンが無いこと
            ls_dump = page.evaluate("() => JSON.stringify(localStorage)")
            assert "wrongpass" not in ls_dump and "mock-token" not in ls_dump
            print("[E2E] Wrong password rejection & zero localStorage leak OK")

            # 3. 正しい学校名＋パスワードで認証成功
            page.fill("#teacher-password-input", "hino2026")
            page.click("#teacher-auth-submit")
            page.wait_for_selector(".teacher-view")
            assert "hino校" in page.locator(".teacher-topbar").inner_text()
            assert "CSV" not in page.locator(".teacher-topbar").inner_text()
            # localStorage に認証トークンやパスワードが一切保存されていないことを再確認
            ls_dump = page.evaluate("() => JSON.stringify(localStorage)")
            assert "hino2026" not in ls_dump and "mock-token" not in ls_dump
            ss_dump = page.evaluate("() => JSON.stringify(sessionStorage)")
            assert "mock-token-12345" in ss_dump and "hino2026" not in ss_dump
            print("[E2E] Auth success & sessionStorage-only token storage OK")

            # 4. 進捗マトリクス（デフォルト：ログあり児童のみ → 1〜40番全員表示トグル）
            normal_rows = page.locator(".td-matrix-table tbody tr").count()
            assert normal_rows == 2, f"Expected 2 rows for Kokugo logs, got {normal_rows}"
            page.screenshot(path=str(SHOT_DIR / "teacher_dashboard_matrix.png"))

            page.check("#td-matrix-all-toggle")
            all_rows = page.locator(".td-matrix-table tbody tr").count()
            assert all_rows == 40, f"Expected 40 rows when 1-40 toggle is ON, got {all_rows}"
            print("[E2E] Progress matrix 1-40 toggle OK:", normal_rows, "->", all_rows)

            # セルクリック → 詳細履歴 → 誤答問題プレビュー
            page.locator(".td-mcell-btn").first.click()
            page.wait_for_selector("#teacher-detail-modal:not(.hidden)")
            page.locator("#teacher-detail-body .td-pid-btn").first.click()
            page.wait_for_timeout(150)
            assert "問題プレビュー" in page.locator("#teacher-detail-title").inner_text()
            assert page.locator(".td-prob-answer").is_visible()
            page.screenshot(path=str(SHOT_DIR / "teacher_problem_preview.png"))
            page.click("#teacher-detail-modal .modal-close-btn")
            print("[E2E] Matrix cell history & problem preview modal OK")

            # 5. 児童別一覧タブ → 児童カルテ
            page.click('[data-td-tab="students"]')
            assert page.locator(".td-panel .td-data-table tbody tr").count() == 3
            page.locator(".td-panel .td-clickable-row").first.click()
            page.wait_for_selector("#teacher-detail-modal:not(.hidden)")
            assert "児童カルテ" in page.locator("#teacher-detail-title").inner_text()
            page.click("#teacher-detail-modal .modal-close-btn")
            print("[E2E] Student list & karte modal OK")

            # 6. 単元・誤答分析タブ
            page.click('[data-td-tab="units"]')
            assert page.locator(".td-wrong-item").count() >= 1
            assert "4JA_007_D_01" in page.locator(".td-wrong-item").first.inner_text()
            page.screenshot(path=str(SHOT_DIR / "teacher_units_wrong.png"))
            print("[E2E] Unit & wrong_ids ranking tab OK")

            # 7. 実施ログ一覧タブ & フィルタ
            page.click('[data-td-tab="logs"]')
            assert page.locator(".td-panel .td-data-table tbody tr").count() == 4
            page.select_option("#td-filter-class", "2組")
            assert page.locator(".td-panel .td-data-table tbody tr").count() == 1
            page.select_option("#td-filter-class", "すべて")

            # 8. 最新に更新
            page.click("#td-refresh-btn")
            page.wait_for_selector(".td-notice-banner")
            assert "最新" in page.locator(".td-notice-banner").inner_text()
            print("[E2E] Logs tab, filter & refresh OK")

            # モバイル幅レイアウト撮影
            page.set_viewport_size({"width": 390, "height": 844})
            page.click('[data-td-tab="matrix"]')
            page.uncheck("#td-matrix-all-toggle")
            page.wait_for_timeout(150)
            page.screenshot(path=str(SHOT_DIR / "teacher_mobile.png"))

            # 9. ログアウト確認
            page.click("#td-logout-btn")
            page.wait_for_selector(".subject-card")
            ss_after = page.evaluate("() => sessionStorage.getItem('gakuryoku_teacher_session_v1')")
            assert ss_after is None, "sessionStorage should be cleared on logout"
            assert any(c.get("action") == "teacher_logout" for c in api_calls)
            print("[E2E] Logout & session cleanup OK")

            browser.close()

        assert len(console_errors) == 0, f"Console errors detected: {console_errors}"
        print("\n[SUCCESS] Teacher dashboard E2E test passed with 0 errors!")
    finally:
        server.shutdown()


if __name__ == "__main__":
    run()
