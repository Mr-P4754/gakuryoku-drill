/**
 * 標準学力調査対策デジタルドリル 設定ファイル
 *
 * 【教員向け設定手順】
 * 1. Googleスプレッドシート「標準学力調査対策_デジタルドリルDB」を開き、
 *    「拡張機能」→「Apps Script」から gas/Code.gs を貼り付けてデプロイします。
 * 2. 発行されたウェブアプリURL（https://script.google.com/macros/s/.../exec）を
 *    下記の GAS_API_URL に設定してください。
 * 3. URL未設定の場合でも、同梱の静的JSONキャッシュ（data/*.json）で
 *    全77単元の演習がそのまま動作します。また設定画面からもGAS URLを登録できます。
 */
export const APP_CONFIG = {
  APP_TITLE: '標準学力調査たいさく デジタルドリル',
  SPREADSHEET_ID: '1Au59gUt-qiAPspIrg7ZcQMB5UiQ-1HMUrAXHqsTA2dY',
  /**
   * GAS ウェブアプリURL（設定すると最新スプレッドシート同期＆学習ログ送信が有効になります）
   * 例: 'https://script.google.com/macros/s/AKfycb.../exec'
   */
  GAS_API_URL: '',
  /**
   * スプレッドシートの公開gviz直接読込を有効にするか（GAS未設定時、シートがリンク閲覧可の場合に利用可）
   */
  ENABLE_GVIZ_FALLBACK: false,
  /**
   * セッションキャッシュ有効時間（ミリ秒）: 既定 30分
   */
  CACHE_TTL_MS: 30 * 60 * 1000,
  /**
   * 既定の学年
   */
  DEFAULT_GRADE: '4年',
  /**
   * 組の選択肢
   */
  CLASS_OPTIONS: ['1組', '2組', '3組', '4組', '5組', '6組', '7組', '8組'],
  /**
   * 出席番号の最大値
   */
  MAX_STUDENT_NO: 45,
};
