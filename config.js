/**
 * HSS動画試験 設定ファイル（hss-exam-video）
 * ============================================================
 * このファイルを編集して、試験の設定を変更できます。
 * パスワードを変更する場合は、SHA-256ハッシュ値を設定してください。
 *
 * ハッシュ生成方法（ブラウザのコンソールで実行）:
 *   async function hash(pw) {
 *     const buf = await crypto.subtle.digest('SHA-256',
 *       new TextEncoder().encode(pw));
 *     return [...new Uint8Array(buf)]
 *       .map(b => b.toString(16).padStart(2,'0')).join('');
 *   }
 *   hash('新しいパスワード').then(console.log);
 *
 * または bash:
 *   echo -n "新しいパスワード" | sha256sum
 * ============================================================
 */
var CONFIG = {
  // === パスワード（SHA-256ハッシュ） === hss-exam と同じ値を引き継いでいる
  passwordHash: "354948ef61d10149fa91ad1bf6a8676f94e7d6f2b0f7d1920797b8fbe56b3c81",

  // === 記録先 ===
  email: {
    // Google Apps Script Web App URL。
    // ⚠️ 空のまま＝どこにも記録されない（結果画面に手動送信ボタンが出る）。
    //    本番前に gas/Code.gs を「新しい」GASプロジェクトとしてデプロイし、その /exec URL を入れる。
    //    hss-exam(学科)のGASを流用すると同じスプレッドシートに混ざるので流用しない。
    webhookUrl: "https://script.google.com/macros/s/AKfycbyRaRv_bsOlFCuaQh9p4jJY-qfVeOl4MX8rbMqLMr7bVbYirNJeVnyYBpxKcS1pXmky/exec",
    adminEmail: "so@oikk.co.jp",
    subjectExam: "【HSS動画試験】結果通知 - {name}",
    subjectConfirm: "【HSS動画試験】受験意志確認 - {name}",
  },

  // === 試験設定 ===
  test: {
    questionsPerTest: 30,   // 1回の試験で出題する問題数。data/questions.json がこれより多ければ required=true を必ず含めてランダム抽出
    timeLimit: 30,          // 制限時間（分）※動画の準備(ダウンロード)中は時計を動かさない
    passRate: 70,           // 合格基準（%）
  },

  // === 動画設定 ===
  video: {
    maxPlaysExam: 2,        // 本試験: 1問あたり動画を最初から再生できる回数（0=無制限）。途中で止めて続きを見るのは数えない
    maxPlaysDemo: 0,        // デモ: 0=無制限
  },

  // === デモ問題（練習用） ===
  demo: {
    enabled: true,
    requirePassword: true,
    // デモ用パスワード（SHA-256ハッシュ）: 123
    passwordHash: "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
    questionsFile: "data/demo-questions.json",
    questionCount: 3,       // 問題数（UI表示用。demo-questions.jsonの問題数と一致させる）
    timeLimit: 5,           // 制限時間（分）
    passRate: 70,           // 合格基準（%）
  },

  // === 会社情報 ===
  company: {
    name: "株式会社ヒラノ",
    system: "HSS認定制度",
    examTitle: "HSS動画 本試験",
  },

  // === QRコード配布URL ===
  appUrl: "https://shoichiokada225-sys.github.io/hss-exam-video/",
};
