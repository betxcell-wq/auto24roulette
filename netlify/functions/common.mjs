import { getStore } from "@netlify/blobs";

export const REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export const D2 = new Set(Array.from({length:12}, (_,i)=>i+13));
export const D3 = new Set(Array.from({length:12}, (_,i)=>i+25));

export const NORMAL_SPEED_MS = 2000;
export const TURBO_SPEED_MS = 500;

const store = () => getStore({ name: "roulette-demo", consistency: "strong" });

export function defaultState(userId) {
  return {
    userId: String(userId),
    strategyVersion: 2,
    balance: 1000,
    startBalance: 1000,
    unit: 1,
    target: 50,
    stoploss: 100,
    stage: 1,
    deficit: 0,
    maxRiskPct: 35,
    cyclePl: 0,
    spins: 0,
    cycles: 0,
    wins: 0,
    losses: 0,
    peakBalance: 1000,
    maxDrawdown: 0,
    running: false,
    runId: null,
    speedMs: NORMAL_SPEED_MS,
    pendingInput: null,
    pendingWithdrawalAmount: null,
    demoWithdrawals: [],
    history: []
  };
}

export async function getState(userId) {
  const s = store();
  const key = `user-${userId}`;
  const value = await s.get(key, { type: "json" });
  if (value) {
    // Migrate users from the previous 4-step strategy without changing balance/settings.
    if (value.strategyVersion !== 2) {
      value.strategyVersion = 2;
      value.stage = 1;
      value.deficit = 0;
      value.cyclePl = 0;
      value.running = false;
      value.runId = null;
      value.maxRiskPct = value.maxRiskPct || 35;
      await s.setJSON(key, value);
    }
    return value;
  }
  const fresh = defaultState(userId);
  await s.setJSON(key, fresh);
  return fresh;
}

export async function saveState(userId, state) {
  await store().setJSON(`user-${userId}`, state);
  return state;
}

export async function getWithdrawalQueue() {
  return (await store().get("demo-withdrawal-queue", { type: "json" })) || [];
}

export async function saveWithdrawalQueue(queue) {
  await store().setJSON("demo-withdrawal-queue", queue.slice(0, 200));
  return queue;
}


export function unitsAt(stage, deficit = 0) {
  // Exact-recovery sequence from the reference simulator:
  // 1 → 2 → 3 → 12 → 18 → 72 → 108 → 432 ...
  if (stage === 1) return 1;
  if (stage === 2) return 2;
  if (stage === 3) return 3;
  const isRed = stage % 2 === 1;
  return isRed ? deficit : 2 * deficit;
}

export function stageInfo(stage, unit, deficit = 0) {
  const units = unitsAt(stage, deficit);
  const isRed = stage % 2 === 1;
  return {
    units,
    risk: units * unit,
    isRed,
    title: isRed
      ? `LEVEL ${stage} — RED`
      : `LEVEL ${stage} — 2ND + 3RD DOZENS`
  };
}

export function resultFor(stage, n, unit, deficit = 0) {
  const info = stageInfo(stage, unit, deficit);
  if (info.isRed) {
    return REDS.has(n)
      ? { pnl: info.risk, label: "RED WIN", complete: true }
      : { pnl: -info.risk, label: "RED LOSS", complete: false };
  }

  // Total wager is split equally between the 2nd and 3rd dozens.
  // A hit returns 3x the winning half, so net P/L = +half of total risk.
  const hit = D2.has(n) || D3.has(n);
  return hit
    ? { pnl: info.risk / 2, label: "DOZENS WIN", complete: true }
    : { pnl: -info.risk, label: "DOZENS LOSS", complete: false };
}

export async function executeSpin(userId, expectedRunId = null) {
  let st = await getState(userId);

  if (expectedRunId && (!st.running || st.runId !== expectedRunId)) {
    return { stopped: true, state: st };
  }

  const stage = st.stage || 1;
  const unit = st.unit;
  const deficit = Number(st.deficit || 0);
  const { risk, units } = stageInfo(stage, unit, deficit);
  const maxRiskPct = Number(st.maxRiskPct || 35);
  const riskPct = st.balance > 0 ? (risk / st.balance * 100) : 100;

  if (stage > 1 && riskPct > maxRiskPct) {
    st.running = false;
    st.runId = null;
    await saveState(userId, st);
    return { stopped: true, reason: `Recovery stopped: next wager is ${riskPct.toFixed(1)}% of bankroll, above the ${maxRiskPct}% limit.`, state: st };
  }

  if (st.balance + 1e-9 < risk) {
    st.running = false;
    st.runId = null;
    await saveState(userId, st);
    return { stopped: true, reason: "Insufficient demo balance for the next wager.", state: st };
  }

  const n = Math.floor(Math.random() * 37);
  const r = resultFor(stage, n, unit, deficit);
  const balance = st.balance + r.pnl;
  const cyclePl = st.cyclePl + r.pnl;
  const spins = st.spins + 1;
  const cycles = st.cycles + (r.complete ? 1 : 0);
  const wins = st.wins + (r.pnl > 0 ? 1 : 0);
  const losses = st.losses + (r.pnl <= 0 ? 1 : 0);
  const peakBalance = Math.max(st.peakBalance, balance);
  const drawdown = Math.max(0, peakBalance - balance);
  const maxDrawdown = Math.max(st.maxDrawdown, drawdown);

  st = {
    ...st,
    balance,
    stage: r.complete ? 1 : stage + 1,
    deficit: r.complete ? 0 : deficit + units,
    cyclePl: r.complete ? 0 : cyclePl,
    spins, cycles, wins, losses,
    peakBalance, maxDrawdown
  };

  const item = {
    spin: spins,
    number: n,
    stage,
    label: r.label,
    pnl: r.pnl,
    balance,
    ts: Date.now()
  };
  st.history = [item, ...(st.history || [])].slice(0, 50);

  const session = st.balance - st.startBalance;
  let reason = null;
  if (st.target > 0 && session >= st.target) {
    st.running = false;
    st.runId = null;
    reason = `Profit target reached: ${fmtSigned(session)} credits.`;
  } else if (st.stoploss > 0 && session <= -st.stoploss) {
    st.running = false;
    st.runId = null;
    reason = `Stop target reached: ${fmtSigned(session)} credits.`;
  }

  // Check whether Stop/Reset changed runId while this spin was being calculated.
  if (expectedRunId) {
    const latest = await getState(userId);
    if (latest.runId !== expectedRunId || !latest.running) {
      st.running = false;
      st.runId = null;
    }
  }

  await saveState(userId, st);
  return { state: st, result: item, reason };
}

export function fmt(n) { return Number(n).toFixed(2); }
export function fmtSigned(n) { return `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}`; }

export function statusText(st, result=null, reason=null) {
  const session = st.balance - st.startBalance;
  const total = st.wins + st.losses;
  const wr = total ? (st.wins / total * 100) : 0;
  const info = stageInfo(st.stage || 1, st.unit, Number(st.deficit || 0));

  let betLines = "";
  if (info.isRed) {
    betLines = `${info.units} unit${info.units === 1 ? "" : "s"} • Red`;
  } else {
    const half = info.units / 2;
    betLines = `${half} units • 2nd Dozen\n${half} units • 3rd Dozen\nTotal risk • ${info.units} units`;
  }

  let top = "";
  if (result) {
    top += `🎲 LAST SPIN: ${result.number}   (Spin #${result.spin})\n`;
    top += `Step ${result.stage} — ${result.label}\n`;
    top += `Spin P/L: ${fmtSigned(result.pnl)}\n────────────────────\n`;
  }
  if (reason) top += `⛔ ${reason}\n────────────────────\n`;

  return top +
`🎰 ROULETTE DEMO BOT
────────────────────
Balance     ${fmt(st.balance)}
Session P/L ${fmtSigned(session)}
Unit        ${fmt(st.unit)}
Spins       ${st.spins}
Cycles      ${st.cycles}
Win Rate    ${wr.toFixed(1)}%
Drawdown    ${fmt(st.maxDrawdown)}
Deficit     ${fmt((st.deficit || 0) * st.unit)}
────────────────────
${info.title}
${betLines}
Current risk • ${fmt(info.risk)} (${info.units}u)
────────────────────
Auto • ${st.running ? "RUNNING" : "STOPPED"}`;
}

export function statsText(st) {
  const session = st.balance - st.startBalance;
  const total = st.wins + st.losses;
  const wr = total ? st.wins / total * 100 : 0;
  return `📊 SESSION STATS

Balance: ${fmt(st.balance)} credits
Session P/L: ${fmtSigned(session)}
Unit Size: ${fmt(st.unit)}
Profit Target: +${fmt(st.target)}
Stop Target: -${fmt(st.stoploss)}

Spins: ${st.spins}
Cycles: ${st.cycles}
Wins: ${st.wins}
Losses: ${st.losses}
Win Rate: ${wr.toFixed(1)}%
Max Drawdown: ${fmt(st.maxDrawdown)}
Recovery Level: ${st.stage || 1}
Recovery Deficit: ${fmt((st.deficit || 0) * st.unit)}
Max Recovery Risk: ${st.maxRiskPct || 35}% bankroll

Auto: ${st.running ? "RUNNING" : "STOPPED"}`;
}

export function historyText(st) {
  const rows = (st.history || []).slice(0, 12);
  if (!rows.length) return "🧾 HISTORY\n\nNo spins yet.";
  return "🧾 LAST 12 SPINS\n\n" + rows.map(r =>
    `#${r.spin} • ${r.number} • L${r.stage} • ${r.label} • ${fmtSigned(r.pnl)} • Bal ${fmt(r.balance)}`
  ).join("\n");
}

export function mainKeyboard(st) {
  const turbo = st.speedMs <= TURBO_SPEED_MS;
  return {
    inline_keyboard: [
      [
        { text: st.running ? "⏹ Stop Auto" : "▶️ Start Auto", callback_data: st.running ? "stop" : "start" },
        { text: turbo ? "⚡ TURBO ON" : "⚡ Turbo Speed", callback_data: turbo ? "speed_normal" : "speed_turbo" }
      ],
      [
        { text: "⚙️ Bet Settings", callback_data: "settings" },
        { text: "📊 Stats", callback_data: "stats" }
      ],
      [
        { text: "🧾 History", callback_data: "history" },
        { text: "🔄 Reset", callback_data: "reset" }
      ],
      [
        { text: "➕ Demo Deposit", callback_data: "deposit100" },
        { text: "➖ Demo Withdraw", callback_data: "demo_withdraw" }
      ],
      [
        { text: "₿ Support with BTC", callback_data: "btc_support" },
        { text: "📋 Demo Withdrawals", callback_data: "demo_withdrawals" }
      ]
    ]
  };
}

export function settingsKeyboard() {
  return { inline_keyboard: [
    [{ text: "💰 Unit Size", callback_data: "input_unit" }],
    [{ text: "🎯 Profit Target", callback_data: "input_target" }],
    [{ text: "🛑 Stop Target", callback_data: "input_stop" }],
    [{ text: "🎰 Dashboard", callback_data: "dashboard" }]
  ]};
}

export function viewKeyboard() {
  return { inline_keyboard: [
    [{ text: "🎰 Dashboard", callback_data: "dashboard" }],
    [{ text: "📊 Stats", callback_data: "stats" }, { text: "🧾 History", callback_data: "history" }],
    [{ text: "🔄 Reset Session", callback_data: "reset" }]
  ]};
}

export function telegramApi(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).then(async r => {
    const data = await r.json();
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || "unknown error"}`);
    return data.result;
  });
}

export async function safeEdit(chatId, messageId, text, replyMarkup) {
  try {
    await telegramApi("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: replyMarkup
    });
  } catch (e) {
    if (!String(e.message).includes("message is not modified")) throw e;
  }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
