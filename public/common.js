// Shared by every game: sends the score to the bot and shows the chat leaderboard.
(function () {
  const p = new URLSearchParams(location.search);
  const ctx = { d: p.get("d"), s: p.get("s") };
  const inTelegram = !!(ctx.d && ctx.s);

  async function post(path, extra) {
    if (!inTelegram) return null;
    try {
      const r = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.assign({}, ctx, extra || {})),
      });
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  const css = document.createElement("style");
  css.textContent =
    ".go{position:fixed;inset:0;background:rgba(5,5,16,.82);display:flex;align-items:center;justify-content:center;" +
    "font-family:-apple-system,system-ui,sans-serif;color:#fff;z-index:9}" +
    ".go-card{width:min(300px,82vw);text-align:center}" +
    ".go-label{font-size:13px;letter-spacing:.14em;text-transform:uppercase;opacity:.6}" +
    ".go-score{font-size:64px;font-weight:800;line-height:1.1;margin:4px 0 18px}" +
    ".go-list{text-align:left;font-size:16px;margin:0 0 20px;min-height:24px}" +
    ".go-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.12)}" +
    ".go-row.me{color:#5ef2ff;font-weight:700}" +
    ".go-btn{width:100%;border:0;border-radius:14px;padding:15px;font-size:17px;font-weight:700;" +
    "background:#5ef2ff;color:#06121a}";
  document.head.appendChild(css);

  // Call when the run ends. `restart` is called when the player taps Play again.
  window.gameOver = async function (score, restart) {
    const o = document.createElement("div");
    o.className = "go";
    o.innerHTML =
      '<div class="go-card"><div class="go-label">Score</div><div class="go-score"></div>' +
      '<div class="go-list"></div><button class="go-btn">Play again</button></div>';
    o.querySelector(".go-score").textContent = score;
    const list = o.querySelector(".go-list");
    document.body.appendChild(o);
    // Small delay so the tap that ended the run doesn't hit the button.
    setTimeout(function () {
      o.querySelector(".go-btn").onclick = function () {
        o.remove();
        restart();
      };
    }, 350);

    if (!inTelegram) {
      list.textContent = "Open the game from a Telegram chat to save scores.";
      return;
    }
    const saved = await post("/score", { score: Math.floor(score) });
    if (!saved || !saved.ok) {
      list.textContent = "Score not saved: " + ((saved && saved.error) || "no connection");
      return;
    }
    const r = await post("/scores");
    if (!r || !r.scores) return;
    if (saved.card) {
      const note = document.createElement("div");
      note.style.cssText = "font-size:12px;opacity:.6;margin-bottom:8px";
      note.textContent = "Card not updated: " + saved.card;
      list.appendChild(note);
    }
    r.scores.forEach(function (x) {
      const row = document.createElement("div");
      row.className = "go-row" + (x.me ? " me" : "");
      const a = document.createElement("span");
      a.textContent = x.position + ". " + x.name;
      const b = document.createElement("span");
      b.textContent = x.score;
      row.append(a, b);
      list.appendChild(row);
    });
  };
})();
