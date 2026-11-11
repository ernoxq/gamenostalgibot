// Telegram game bot: inline games with per-chat high scores.
// Short names must match the ones registered in @BotFather via /newgame,
// and each game lives in public/<short_name>/index.html.
// Order matters: register games in BotFather in this order. If Telegram rejects
// the inline list (a short name is not registered yet), the bot retries with
// fewer games from the end, so already registered ones keep working.
const GAMES = {
  racer: "Grid Racer",
  ski: "Snow Zigzag",
  tiles: "Tile Dash",
  knives: "Blade Wheel",
  // cannon: "Star Cannon",
  // runner: "Roof Runner",
};

const enc = new TextEncoder();

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

function b64u(str) {
  let bin = "";
  for (const b of enc.encode(str)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64u(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function sign(env, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(env.BOT_TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The game page gets a signed context (who is playing, in which message).
// Only a context signed by us is accepted back on /score and /scores.
async function readCtx(env, body) {
  if (!body || typeof body.d !== "string" || typeof body.s !== "string") return null;
  if ((await sign(env, body.d)) !== body.s) return null;
  try {
    return JSON.parse(unb64u(body.d));
  } catch {
    return null;
  }
}

// An explicit Play button matters: without our own keyboard Telegram does not
// tell the bot which inline message was pressed, so the score has nowhere to go.
const playMarkup = (short) => ({
  inline_keyboard: [[{ text: `Play ${GAMES[short]}!`, callback_game: {} }]],
});

const target = (c) => (c.i ? { inline_message_id: c.i } : { chat_id: c.c, message_id: c.m });

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const cardText = (top) =>
  "<b>Top Players</b>\n" + top.map((x) => `${x.position}. ${esc(x.name)} \u2013 <b>${x.score}</b>`).join("\n");

const rank = (scores) =>
  Object.entries(scores)
    .map(([u, v]) => ({ u: Number(u), name: v.n, score: v.s }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((x, i) => ({ ...x, position: i + 1 }));

// One scoreboard per game card.
async function board(env, ctx, entry) {
  const key = ctx.i || `${ctx.c}:${ctx.m}`;
  const stub = env.BOARD.get(env.BOARD.idFromName(key));
  const r = await stub.fetch("https://board/", entry ? { method: "POST", body: JSON.stringify(entry) } : {});
  return r.json();
}

export class Board {
  constructor(state) {
    this.state = state;
  }
  async fetch(req) {
    const scores = (await this.state.storage.get("scores")) || {};
    let improved = false;
    if (req.method === "POST") {
      const { u, n, s } = await req.json();
      const prev = scores[u];
      improved = !prev || s > prev.s;
      if (improved) scores[u] = { n, s };
      else prev.n = n;
      await this.state.storage.put("scores", scores);
    }
    return json({ improved, top: rank(scores) });
  }
}

async function onUpdate(env, origin, u) {
  if (u.inline_query) {
    const q = (u.inline_query.query || "").trim().toLowerCase();
    const all = Object.keys(GAMES);
    for (let n = all.length; n > 0; n--) {
      const results = all
        .slice(0, n)
        .filter((short) => !q || short.includes(q) || GAMES[short].toLowerCase().includes(q))
        .map((short) => ({
          type: "game",
          id: short,
          game_short_name: short,
          reply_markup: playMarkup(short),
        }));
      const r = await tg(env, "answerInlineQuery", {
        inline_query_id: u.inline_query.id,
        results,
        cache_time: 5,
      });
      if (r.ok) break;
    }
    return;
  }

  if (u.callback_query) {
    const cq = u.callback_query;
    const g = cq.game_short_name;
    if (!g || !GAMES[g]) {
      await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
      return;
    }
    const ctx = { u: cq.from.id, g, n: String(cq.from.first_name || "Player").slice(0, 32) };
    if (cq.inline_message_id) ctx.i = cq.inline_message_id;
    else if (cq.message) {
      ctx.c = cq.message.chat.id;
      ctx.m = cq.message.message_id;
    }
    const d = b64u(JSON.stringify(ctx));
    const s = await sign(env, d);
    await tg(env, "answerCallbackQuery", {
      callback_query_id: cq.id,
      url: `${origin}/${g}/?d=${d}&s=${s}`,
    });
    return;
  }

  // /games (or /play) in a group where the bot is a member: post every game card there.
  if (u.message && /^\/(games|play)(@\w+)?(\s|$)/.test(u.message.text || "")) {
    for (const short of Object.keys(GAMES)) {
      await tg(env, "sendGame", {
        chat_id: u.message.chat.id,
        game_short_name: short,
        reply_markup: playMarkup(short),
      });
    }
    return;
  }

  if (u.message && u.message.chat && u.message.chat.type === "private") {
    await tg(env, "sendMessage", {
      chat_id: u.message.chat.id,
      text: "Выбери чат — и отправь туда игру. Рекорды считаются отдельно в каждом чате.",
      reply_markup: {
        inline_keyboard: [[{ text: "Выбрать чат", switch_inline_query: "" }]],
      },
    });
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/webhook" && req.method === "POST") {
      if (req.headers.get("x-telegram-bot-api-secret-token") !== (env.WEBHOOK_SECRET || "").trim()) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        await onUpdate(env, url.origin, await req.json());
      } catch (e) {
        console.error(e);
      }
      return new Response("ok");
    }

    if (url.pathname === "/score" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const ctx = await readCtx(env, body);
      const score = body && body.score;
      if (!ctx || !Number.isInteger(score) || score < 0 || score > 1e9) {
        return json({ ok: false }, 400);
      }
      if (!ctx.i && !ctx.m) {
        return json({ ok: false, error: "Send a new game card to the chat and open the game from it." });
      }

      // First the native Telegram scoreboard. Where it works, Telegram updates the
      // card itself and posts the "scored" line.
      const native = await tg(env, "setGameScore", { user_id: ctx.u, score, ...target(ctx) });
      if (native.ok || /NOT_MODIFIED/.test(native.description || "")) {
        return json({ ok: true, improved: !!native.ok });
      }

      // Telegram refused (it does for cards sent to private chats). Keep our own
      // scoreboard for this card and write Top Players into the card ourselves.
      if (!env.BOARD) return json({ ok: false, error: native.description || "score refused" });
      const res = await board(env, ctx, { u: ctx.u, n: ctx.n || "Player", s: score });
      let card = null;
      if (res.improved) {
        const edit = await tg(env, "editMessageText", {
          ...target(ctx),
          text: cardText(res.top),
          parse_mode: "HTML",
          reply_markup: playMarkup(ctx.g),
        });
        if (!edit.ok && !/not modified/.test(edit.description || "")) card = edit.description || "edit failed";
      }
      return json({ ok: true, improved: res.improved, card });
    }

    if (url.pathname === "/scores" && req.method === "POST") {
      const ctx = await readCtx(env, await req.json().catch(() => null));
      if (!ctx) return json({ ok: false }, 400);
      const r = await tg(env, "getGameHighScores", { user_id: ctx.u, ...target(ctx) });
      if (r.ok) {
        const scores = r.result.map((x) => ({
          position: x.position,
          name: x.user.first_name,
          score: x.score,
          me: x.user.id === ctx.u,
        }));
        return json({ ok: true, scores });
      }
      if (!env.BOARD) return json({ ok: true, scores: [] });
      const res = await board(env, ctx);
      return json({ ok: true, scores: res.top.map((x) => ({ ...x, me: x.u === ctx.u })) });
    }

    // One-time: open /setup?key=<WEBHOOK_SECRET> in a browser after deploy.
    if (url.pathname === "/setup") {
      const secret = (env.WEBHOOK_SECRET || "").trim();
      const key = (url.searchParams.get("key") || "").trim();
      if (!secret) return new Response("WEBHOOK_SECRET is not set in Cloudflare (Settings > Variables and Secrets)", { status: 403 });
      if (!env.BOT_TOKEN) return new Response("BOT_TOKEN is not set in Cloudflare (Settings > Variables and Secrets)", { status: 403 });
      if (key !== secret) {
        return new Response(
          `key does not match WEBHOOK_SECRET (key has ${key.length} characters, secret has ${secret.length})`,
          { status: 403 },
        );
      }
      const r = await tg(env, "setWebhook", {
        url: `${url.origin}/webhook`,
        secret_token: secret,
        allowed_updates: ["message", "inline_query", "callback_query"],
      });
      return json(r);
    }

    return new Response("not found", { status: 404 });
  },
};
