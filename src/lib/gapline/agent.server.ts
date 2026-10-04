export async function interpretRule(sentence: string, tape: string): Promise<{ ok: true; rewrite: string; explanation: string } | { ok: false; error: string }> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { ok: false, error: "The agent is not available right now." };
  const text = sentence.trim().slice(0, 400);
  if (!text) return { ok: false, error: "Write a sentence first." };

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "grok-4.5",
      max_tokens: 220,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are Gapline's rules agent. Spot stocks only, no perps. Rewrite the user's sentence into one sentence the desk can schedule. Allowed shapes: Buy $N of the widest liquid gap while the market is closed. Put $N into the AI basket every Monday and fix it if a name drifts past P%. If Bitcoin is up and the stock is not, buy nothing. Buy $N of TICKER when it trades under the reference while the market is closed. Sell $N of TICKER when it trades rich versus the reference. Sell TICKER if it is P% above what I paid. Sell TICKER if it falls P% from what I paid. If they ask for earnings, a stock/crypto mix, or to buy a thin name anyway, still write the nearest sentence so the desk can refuse it. Never tell them to bypass a refusal. Reply with JSON only: {\"rewrite\":\"...\",\"explanation\":\"one or two plain sentences\"}.",
        },
        { role: "user", content: `Tape:\n${tape.slice(0, 1200)}\n\nSentence:\n${text}` },
      ],
    }),
  });
  if (!res.ok) return { ok: false, error: "The agent could not read that. The sentence was checked without it." };
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = body.choices?.[0]?.message?.content ?? "";
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "The agent could not read that. The sentence was checked without it." };
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { rewrite?: string; explanation?: string };
    const rewrite = parsed.rewrite?.trim();
    const explanation = parsed.explanation?.trim();
    if (!rewrite || !explanation) return { ok: false, error: "The agent could not read that. The sentence was checked without it." };
    return { ok: true, rewrite: rewrite.slice(0, 400), explanation: explanation.slice(0, 400) };
  } catch {
    return { ok: false, error: "The agent could not read that. The sentence was checked without it." };
  }
}
