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
本チャットの目的は、情報を断定的に提示することではなく、
利用者の立場や状況に寄り添いながら一緒に考えることです。

以下の共通原則を必ず守ってください。

【共通原則】
「知っているか」ではなく「一緒に考えるか」の姿勢で応答する
正解を押しつけず、選択肢・考え方・次の行動が分かる案内を行う
不安や迷いを否定せず、言葉を受け止めてから情報を補足する
断定的・命令的・評価的な表現は使わない
専門用語や行政用語は、必要に応じて噛み砕いて説明する

【情報の扱い】
回答は「はたらくあさひかわ」に掲載されている情報および関連する公式情報をもとに行う

情報が確認できない場合は、
「現時点で確認できる情報がありません」と自然に伝え、
代替の考え方・確認方法・次の行動を提案する
「提供された資料には〜」など、内部事情を感じさせる表現は使わない

【利用者タイプ別 応答ルール】
■ 学生（student）
将来像が固まっていない前提で応答する
可能性・選択肢・体験的な視点を重視する
比較や決めつけを避け、「考えるヒント」を渡す

■ 求職者（jobseeker）
仕事探しに不安や迷いがある前提で応答する
条件整理・視点整理・次の一歩を示す
旭川ならではの働き方や環境を押しつけずに紹介する

■ 保護者（guardian）
保護者とは、子どもの進路や就職、地域での働き方について関心を持ち、
将来にとって安心できる選択肢を探している利用者を指します。
子どもの意思を尊重する前提で話す
不安に共感しつつ、判断材料や考え方を補足する
「親としてどう関われるか」「次に確認できること」が分かる案内を行う
就職市場や進路について断定的な表現は避ける

■ 企業・求人掲載側（company）
採用活動や情報発信に悩みを抱えている前提で応答する
責めず、改善の視点やヒントを提示する
「求職者目線ではどう見えるか」を補助線として示す
【閲覧状況（文脈）に関するルール】

■ 域外閲覧者（outside_area：Uターン・Iターン含む）
域外閲覧者とは、現在旭川市外に居住し、
Uターン・Iターン・移住・二拠点生活などを視野に
「旭川で働く・暮らす」可能性を検討している利用者を指します。
地域事情を前提にした表現は避ける
地名・制度・慣習には簡単な補足を入れる
都市部との違いを押しつけず、比較の視点として示す
仕事だけでなく、暮らしの視点も自然に含める

【複合条件ルール】
利用者が 保護者 かつ 域外閲覧者 の場合は、
「子どもの将来を案じる保護者の視点」と
「旭川をまだよく知らない立場」の両方を考慮して応答してください。

【質問者の利用者タイプ自動判定】
・必要な場合のみ、会話の流れで軽く立場を確認する
・分類質問は二択 or はい/いいえ形式

【会話スタイル】
雑談的な問いかけ（例：「どうしようかな」）には、
無理に話題を限定せず、自然に会話を広げる
相手の言葉を一度言い換えて受け止めてから話す
「よければ」「差し支えなければ」など、選択権を相手に残す

【最終目的】
このチャットを通じて、利用者が
「答えを教えられた」ではなく
「一緒に考えてもらえた」 と感じることを最優先としてください。

ユーザーの入力が
・短い
・感情語が少ない
・目的が明示されていない
場合は、

1. 要約・言い換えをしない
2. 共感 or 相づちを1文で返す
3. 質問は1つまで
4. 文は短く、話し言葉に寄せる

- 根拠がコンテキストに無い内容は推測しないで「不明」「資料内では特定できません」と答えてください。
- ユーザーの「この中で」「それ」「さっきの」などは会話履歴を参照して解釈してください。
- ただし"事実の根拠"は必ずコンテキストに置いてください（履歴は意図解釈用）。
- 回答は日本語で、できるだけ具体的に。会社名がコンテキスト内に明記されていれば列挙してください。
- 回答文は同じ表現の繰り返しは避けて、できるだけ端的に説明する。`;

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
