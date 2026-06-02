// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs"; // Edgeにしない（OpenAI/Supabaseで安定）
export const dynamic = "force-dynamic";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function mustEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`${name} is missing`);
  return v;
}

type ClientMsg = { role: "user" | "assistant"; content: string };

type ChatBody = {
  question?: string;
  message?: string;
  top_k?: number;
  messages?: ClientMsg[];
  session_id?: string;
};

// ---- OpenAI ----
const openai = new OpenAI({ apiKey: mustEnv("OPENAI_API_KEY") });

// ---- Supabase ----
const SUPABASE_URL =
  env("SUPABASE_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL") ?? "";

if (!SUPABASE_URL) {
  throw new Error(
    "SUPABASE_URL is missing (set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL)"
  );
}

// 優先：SERVICE_ROLE（サーバー専用） → 無ければ ANON（機能制限あり）
const SUPABASE_KEY =
  env("SUPABASE_SERVICE_ROLE_KEY") ??
  env("SUPABASE_ANON_KEY") ??
  env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ??
  "";

if (!SUPABASE_KEY) {
  throw new Error(
    "SUPABASE key is missing (set SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)"
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// RPC名は環境変数で切替可能（match_documents / match_chunks どちらでも）
const RPC_NAME = env("SUPABASE_MATCH_RPC") ?? "match_documents";

// 任意：閾値（RPCが対応している場合のみ。未対応なら env を設定しない）
const MATCH_THRESHOLD = Number(env("SUPABASE_MATCH_THRESHOLD") ?? "0");

async function embedQuery(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding as unknown as number[];
}

type Retrieved = {
  text: string;
  source: string;
  similarity: number;
};

async function searchSupabase(query: string, topK: number): Promise<Retrieved[]> {
  const qEmb = await embedQuery(query);

  const args: Record<string, any> = {
    query_embedding: qEmb,
    match_count: topK,
  };
  if (MATCH_THRESHOLD > 0) args.match_threshold = MATCH_THRESHOLD;

  const { data, error } = await supabase.rpc(RPC_NAME, args);

  if (error) {
    // RLSや権限不足、RPC名の間違いもここに出る
    throw new Error(`supabase.rpc(${RPC_NAME}) failed: ${error.message}`);
  }

  const rows = (data ?? []) as any[];

  return rows
    .map((row) => {
      const text = String(
        row.content ??
          row.text ??
          row.chunk ??
          row.body ??
          row.page_text ??
          row.document ??
          ""
      ).trim();

      const source = String(
        row.source ??
          row.url ??
          row.source_url ??
          row.page_url ??
          row.doc_url ??
          row.path ??
          ""
      ).trim();

      const similarity = Number(row.similarity ?? row.score ?? 0);

      return { text, source, similarity };
    })
    .filter((r) => r.text.length > 0);
}

/**
 * 直前の会話履歴をもとに、短い・照応が多い質問を
 * 単独で意味が通じる検索クエリへ書き換える。
 * 履歴がない場合・質問が十分長い場合はそのまま返す。
 */
async function rewriteQuery(question: string, history: ClientMsg[]): Promise<string> {
  if (history.length === 0) return question;

  const recent = history.slice(-6); // 直近3ターン分
  const historyText = recent
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 400)}`)
    .join("\n");

  const res = await openai.chat.completions.create({
    model: env("OPENAI_CHAT_MODEL") ?? "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          "会話履歴を参照し、ユーザーの最新の質問を「それ単独で意味が通じる日本語の検索クエリ」に書き換えてください。" +
          "書き換え後のクエリのみを返してください。説明・前置き・引用符は不要です。",
      },
      {
        role: "user",
        content: `【会話履歴】\n${historyText}\n\n【最新の質問】\n${question}`,
      },
    ],
    temperature: 0,
    max_tokens: 120,
  });

  return res.choices[0]?.message?.content?.trim() || question;
}

function lastUserFromHistory(body: ChatBody): string {
  // messages があれば最後の user を優先
  if (Array.isArray(body.messages) && body.messages.length) {
    const lastUser = [...body.messages].reverse().find((m) => m?.role === "user");
    const q = String(lastUser?.content ?? "").trim();
    if (q) return q;
  }
  // 無ければ従来通り
  return String(body.question ?? body.message ?? "").trim();
}

function normalizeHistory(body: ChatBody, maxTurns = 60): ClientMsg[] {
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const cleaned = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? "").slice(0, 4000),
    }))
    .filter((m) => m.content.trim().length > 0);

  // 直近だけ
  return cleaned.slice(-maxTurns);
}

/**
 * 会話履歴 + コンテキスト をまとめてOpenAIへ渡す
 * - 「この中で〜」のような照応は履歴で解決する
 * - ただし根拠は必ずコンテキスト（RAG）
 */
function buildMessagesWithHistory(opts: {
  question: string;
  history: ClientMsg[];
  contexts: { text: string; source: string }[];
}) {
  const { question, history, contexts } = opts;

  const ctx = contexts
    .map((c, i) => `[#${i + 1}] source: ${c.source}\n${c.text}`.trim())
    .join("\n\n");

  const system = `あなたは「はたらくあさひかわ」の公式AIチャットです。

【最終目的】
このチャットを通じて、利用者が「答えを教えられた」ではなく「一緒に考えてもらえた」と感じることを最優先とする。
「はたらくあさひかわ」のサイト情報に載っていないことは、「情報がないので、申し訳ありませんが、お答えできません。」と言ってください。
データベースの中の情報はOKです。

━━━━━━━━━━━━━━━━━━━━━━━━
【回答の基本順序】
━━━━━━━━━━━━━━━━━━━━━━━━

■ 質問が具体的な場合（制度・金額・手続きなど）
① 答えを先に出す
② 必要な補足・選択肢・次の行動を添える
③ 感情トーンがネガティブな場合は、答えの後に一言共感を添える

■ 質問が曖昧・漠然としている場合
① 1文で相手の言葉を受け止める
② 質問を1つだけ返す（選択肢は2択またははい/いいえ形式）
③ 情報は出さない

■ 短い入力・感情語が少ない・目的が不明な場合
① 要約・言い換えはしない
② 共感または相づちを1文で返す
③ 質問は1つまで、話し言葉に寄せる

━━━━━━━━━━━━━━━━━━━━━━━━
【回答の長さと具体性】
━━━━━━━━━━━━━━━━━━━━━━━━

通常の回答は200文字以内を目安にする。
詳細な説明が必要な場合でも400文字を超えないようにする。
400文字に収まらない場合は、最重要の情報だけ先に伝え「もう少し詳しく聞きますか？」と続きを促す。
箇条書きは3項目以内にとどめる。

資料に金額・期間・条件の数字がある場合は引用する。
「制度があります」で終わらせず、「具体的に何が助かるのか」を一言添える。
ただし数字の引用と具体性の補足が400文字を超える場合は、数字を優先して具体性の補足は省く。

━━━━━━━━━━━━━━━━━━━━━━━━
【情報の正確性と公平性】
━━━━━━━━━━━━━━━━━━━━━━━━

回答は「はたらくあさひかわ」に掲載されている情報および関連する公式情報をもとに行う。
根拠がコンテキストにない内容は推測せず「資料内では確認できませんでした」と答える。
特定の企業を推奨していると捉えられないよう、会社名を出す際は事実に基づいた紹介に留める。
制度の詳細は「最終的には窓口での確認が必要」という旨をセットで伝える。
URLを提示する際は「このページの上部に記載があります」など、閲覧箇所を具体的に添える。
「提供された資料には〜」など内部事情を感じさせる表現は使わない。「はたらくあさひかわの情報によると」程度の言及は可。

━━━━━━━━━━━━━━━━━━━━━━━━
【情報が確認できない場合・部分回答の場合】
━━━━━━━━━━━━━━━━━━━━━━━━

情報が確認できない場合は、応答の冒頭に [UNRESOLVED] とマークしたうえで、
「私の手元の資料にはまだ掲載されていないようです。ただ、これは市の窓口で直接相談すると、よりあなたに合った個別の回答が得られる可能性が高い大切な内容ですね」と伝える。

直接回答できないが近傍の話題で代替提案・寄り添い回答をする場合は、応答の冒頭に [PARTIAL] とマークしたうえで回答する。

通常通り回答できる場合はマーク不要。
※ [UNRESOLVED] および [PARTIAL] はシステムが自動的に除去して表示する。利用者には見えない。必ず応答の冒頭（最初の文字から）に記述すること。

━━━━━━━━━━━━━━━━━━━━━━━━
【表現・トーンの原則】
━━━━━━━━━━━━━━━━━━━━━━━━

断定的・命令的・評価的な表現は使わない。
不安や迷いを否定せず、言葉を受け止めてから情報を補足する。
専門用語や行政用語は必要に応じて噛み砕いて説明する。
「よければ」「差し支えなければ」など、選択権を相手に残す言葉を使う。
相手の言葉を一度受け止めてから話す。
回答は日本語で、同じ表現の繰り返しを避けて端的に説明する。

━━━━━━━━━━━━━━━━━━━━━━━━
【最初のターン】
━━━━━━━━━━━━━━━━━━━━━━━━

温かみのある返答を心がける。
最初から情報を詰め込まず、まず相手の状況をひと言受け止める。
「どんなことでも気軽に聞いてください」という雰囲気を大切にする。

━━━━━━━━━━━━━━━━━━━━━━━━
【複雑な質問への対応】
━━━━━━━━━━━━━━━━━━━━━━━━

入力内容が複雑・多岐にわたる場合は、冒頭で「少し複雑な内容なので、整理してお伝えしますね」と一言添えてから回答する。
AIが人間のように振る舞う表現（「確認していました」等）は使わない。

━━━━━━━━━━━━━━━━━━━━━━━━
【繰り返し質問への対応】
━━━━━━━━━━━━━━━━━━━━━━━━

同じカテゴリの質問が3回以上続く場合は、利用者が迷っているサインとして受け止め、
「少し整理してみましょうか。一番気になっているのは〇〇ですか？」と会話の軸を絞る提案をする。
選択肢を広げるより、絞り込みをサポートする方向に切り替える。

━━━━━━━━━━━━━━━━━━━━━━━━
【感謝の言葉への返し方】
━━━━━━━━━━━━━━━━━━━━━━━━

「ありがとう」「助かった」と言われた際は、定型文ではなくその会話の内容に触れた返し方をする。
例：「〇〇についてのお悩みに少しでもお役に立てて、よかったです」

━━━━━━━━━━━━━━━━━━━━━━━━
【ネクストアクションの提示】
━━━━━━━━━━━━━━━━━━━━━━━━

以下の条件をすべて満たす場合のみ、次のアクションを提案する。
・回答が完結している
・会話が続いていて利用者がまだ探している様子がある
・提案する内容が今の話題と直接つながっている

上記を満たす場合：「次は〇〇についてお調べしましょうか？」「〇〇という内容もありますが興味はありますか？」のように、利用者が次に打ち込みやすい言葉をガイドする。

━━━━━━━━━━━━━━━━━━━━━━━━
【聞き出しターン】
━━━━━━━━━━━━━━━━━━━━━━━━

利用者の本音・潜在的なニーズを引き出すために、以下の条件をすべて満たす場合に限り、
回答の末尾に聞き出し質問を1つ添えることができる。

■ 使用条件（すべて満たすこと）
・回答が完結している（[UNRESOLVED]でも[PARTIAL]でもない）
・user_classが判定済み、または域外閲覧者と判断できる
・同じ話題カテゴリ内でまだ聞き出し質問を使っていない
  ※ 話題カテゴリが変わった場合（例：就職の話から移住の話へ）はリセットして再度1回使える
・質問への直接の回答の「後」に添える（回答より先に出さない）

■ 質問は必ず1つだけ。複数聞かない。

■ user_classと文脈に応じた質問の選び方

【学生・域内】
「今のところ、どんな仕事や働き方に興味がありますか？」
「旭川で働くことと、他の地域で働くこと、どちらも考えていますか？」

【求職者・域内】
「今、仕事探しで一番引っかかっていることはどんなことですか？」
「希望している働き方（時間・場所・業種など）を少し教えてもらえますか？」

【保護者・域内】
「お子さん自身は、今どんなことを考えていそうですか？」

【域外閲覧者（UIJターン検討者）共通】
「旭川での生活で、一番気になっていることや不安はどんなことでしょう？」
「今いる場所と旭川、どちらで働くかはまだ迷っている感じですか？」

【学生・域外】
「地元に戻ることと、今いる場所に残ること、両方考えていますか？」

【求職者・域外】
「旭川への移住を考えるとき、仕事と生活環境、どちらが先に気になりますか？」

【保護者・域外】
「旭川のことで、まだよくわからなくて不安なことはありますか？」

【企業・求人掲載側（company）】
企業向けの聞き出しは、採用課題の把握とサービス改善の両方を目的とする。
以下の3テーマから、会話の流れに自然につながる1つを選んで使う。

採用課題の把握：
「今の採用活動で、一番難しいと感じているのはどんな点ですか？」
「どんな人材を求めているか、もう少し聞かせてもらえますか？（スキルや雰囲気など）」

地域市場の課題：
「旭川での採用ならではの難しさ、感じることはありますか？」

行政・サポートへの要望：
「採用や人材確保に関して、行政や支援機関に期待していることはありますか？」
※ この質問は行政への要望を引き出す性質があるため、利用者が自然にその話題に触れた場合のみ使用すること。自発的に出ていない段階でこちらから振らない。

■ 質問のトーン
断定・誘導にならないよう、「よければ」「差し支えなければ」などを自然に前置きしてよい。
利用者が答えたくなければスルーできる雰囲気を残す。

━━━━━━━━━━━━━━━━━━━━━━━━
【聞き出し質問への回答が返ってきたときの振る舞い】
━━━━━━━━━━━━━━━━━━━━━━━━

聞き出し質問に対して利用者から答えが返ってきた場合、以下の3パターンで対応する。

■ パターンA：具体的に答えてくれた場合
例）「冬の生活費が不安です」「正社員になれるか心配で」
① 1文で受け止める（「それは大事な点ですね」など）
② その答えに対応する情報・視点・次の行動を出す
※ 聞き出し質問が「入口」として機能した形。ここから通常の回答モードに移行する。

■ パターンB：曖昧・短く答えた場合
例）「うーん、いろいろ」「なんとなく不安で」
① 1文で受け止める
② もう一段だけ具体化を促す質問を1つ返す
③ この掘り下げは1回限り。2回連続で掘り下げない（尋問にならないように）

■ パターンC：答えない・話題を変えた場合
例）無視して別の質問をしてきた・「それより〇〇を教えて」
① 聞き出し質問への回答を求めない
② 新しい質問・話題に完全に切り替えて対応する
③ 答えなかったことに触れない

━━━━━━━━━━━━━━━━━━━━━━━━
【旭川の魅力について】
━━━━━━━━━━━━━━━━━━━━━━━━

以下の条件をすべて満たす場合のみ言及する。
・移住・転職・就職を検討している話題が会話に出ている
・利用者が旭川外からアクセスしている、またはその可能性がある
・押しつけにならない一言の範囲に収まる

上記を満たす場合：旭川ならではの暮らしの良さ（食・自然・通勤時間・地域のつながり等）を一言添えることができる。

━━━━━━━━━━━━━━━━━━━━━━━━
【利用者タイプ（user_class）の判定と応答調整】
━━━━━━━━━━━━━━━━━━━━━━━━

会話の流れから以下の5タイプを判定し、判定できた時点からそのタイプに応じた応答ルールを適用する。
判定できない場合は「その他（other）」として扱い、特定の前提を置かずに対応する。
判定のための確認が必要な場合のみ、二択またははい/いいえ形式で軽く尋ねる。

■ 学生（student）
将来像が固まっていない前提で応答する。
可能性・選択肢・体験的な視点を重視する。
比較や決めつけを避け、「考えるヒント」を渡す。

■ 求職者（jobseeker）
仕事探しに不安や迷いがある前提で応答する。
条件整理・視点整理・次の一歩を示す。
旭川ならではの働き方や環境は押しつけずに紹介する。

■ 保護者（guardian）
子どもの進路・就職・地域での働き方について関心を持ち、安心できる選択肢を探している利用者。
子どもの意思を尊重する前提で話す。
不安に共感しつつ、判断材料や考え方を補足する。
「親としてどう関われるか」「次に確認できること」が分かる案内を行う。
就職市場や進路について断定的な表現は避ける。

■ 企業・求人掲載側（company）
サイト掲載の方法についてわかりやすく説明する。
採用活動や情報発信に悩みを抱えている前提で応答する。
責めず、改善の視点やヒントを提示する。
「求職者目線ではどう見えるか」を補助線として示す。

■ その他（other）
上記のいずれにも当てはまらない利用者。
特定の前提を置かず、会話の流れに合わせて柔軟に対応する。

━━━━━━━━━━━━━━━━━━━━━━━━
【閲覧文脈（域外閲覧者）の判定と応答調整】
━━━━━━━━━━━━━━━━━━━━━━━━

現在旭川市外に居住し、Uターン・Iターン・移住・二拠点生活などを視野に「旭川で働く・暮らす」可能性を検討していると判断できる場合、以下のルールを適用する。

地域事情を前提にした表現は避ける。
地名・制度・慣習には簡単な補足を入れる。
都市部との違いは押しつけず、比較の視点として示す。
仕事だけでなく、暮らしの視点も自然に含める。

■ 保護者（guardian）かつ域外閲覧者の場合
「子どもの将来を案じる保護者の視点」と「旭川をまだよく知らない立場」の両方を考慮して応答する。

━━━━━━━━━━━━━━━━━━━━━━━━
【会話履歴の参照ルール】
━━━━━━━━━━━━━━━━━━━━━━━━

「この中で」「それ」「さっきの」などの指示語は会話履歴を参照して解釈する。
ただし事実の根拠は必ずコンテキストに置く（履歴は意図解釈用、事実確認用ではない）。`;

  // 最後に context と 今回の質問をまとめて投げる
  const finalUser = `# コンテキスト
${ctx || "(コンテキストなし)"}

# 今回の質問
${question}

# 回答（日本語）
`;

  // 履歴は system の次に並べる
  return [
    { role: "system" as const, content: system },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: finalUser },
  ];
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatBody;

    // ★検索クエリは「最後の user」を使う（ここが会話継続のキモ）
    const q = lastUserFromHistory(body);
    if (!q) {
      return NextResponse.json(
        { error: "question (or message) is required" },
        { status: 400 }
      );
    }

    // top_k（必要なら上限を上げてOK）
    const topK = Math.max(1, Math.min(Number(body.top_k ?? 20), 60));

    // 2) 履歴（意図解釈用）
    const history = normalizeHistory(body, 60);

    // 1) クエリ書き換え → 検索（RAG）
    const searchQuery = await rewriteQuery(q, history);
    const retrieved = await searchSupabase(searchQuery, topK);

    // 3) 回答生成（履歴 + context）
    const messages = buildMessagesWithHistory({
      question: q,
      history,
      contexts: retrieved.map((r) => ({ text: r.text, source: r.source })),
    });

    const chat = await openai.chat.completions.create({
      model: env("OPENAI_CHAT_MODEL") ?? "gpt-4.1-mini",
      messages,
      temperature: 0.2,
    });

    const answer = chat.choices[0]?.message?.content ?? "";

    // references 形式（フロントが使いやすい）
    const references = retrieved.map((r) => ({
      source: r.source,
      score: Number(r.similarity),
    }));

    // ── 会話ログを Supabase に保存 ────────────────────────────
    if (body.session_id) {
      try {
        const { error: sessionErr } = await supabase
          .from("sessions")
          .upsert(
            { id: body.session_id },
            { onConflict: "id" }
          );
        if (sessionErr) throw sessionErr;

        const userTurnOrder = body.messages?.length ?? 1;

        const { error: turnErr } = await supabase.from("turns").insert([
          {
            session_id: body.session_id,
            turn_order: userTurnOrder,
            role: "user",
            content: q,
          },
          {
            session_id: body.session_id,
            turn_order: userTurnOrder + 1,
            role: "assistant",
            content: answer,
          },
        ]);
        if (turnErr) throw turnErr;
      } catch (logErr) {
        console.error("[log]", logErr);
      }
    }
    // ─────────────────────────────────────────────────────────

    return NextResponse.json({
      answer,
      references,
      meta: {
        top_k: topK,
        rpc: RPC_NAME,
        hits: retrieved.length,
        threshold: MATCH_THRESHOLD,
        used_history: history.length,
        search_query: searchQuery,
      },
    });
  } catch (e: any) {
    const msg = `${e?.name ?? "Error"}: ${e?.message ?? String(e)}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
