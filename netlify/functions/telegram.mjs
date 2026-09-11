import crypto from "node:crypto";
import {
  getState, saveState, getWithdrawalQueue, saveWithdrawalQueue, statusText, statsText, historyText,
  mainKeyboard, settingsKeyboard, viewKeyboard,
  telegramApi, safeEdit, NORMAL_SPEED_MS, TURBO_SPEED_MS
} from "./common.mjs";

function response(obj={ok:true}, status=200) {
  return Response.json(obj, { status });
}

async function launchAuto(userId, chatId, messageId, runId) {
  const base = process.env.URL;
  if (!base) throw new Error("Netlify URL environment variable is unavailable.");
  const r = await fetch(`${base}/.netlify/functions/autospin-background`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, chatId, messageId, runId })
  });
  if (!r.ok && r.status !== 202) throw new Error(`Could not launch background auto spin: HTTP ${r.status}`);
}

async function showSettings(chatId, messageId, st) {
  const text = `⚙️ BET SETTINGS

Current Unit Size: ${st.unit.toFixed(2)} credits
Profit Target: +${st.target.toFixed(2)} credits
Stop Target: -${st.stoploss.toFixed(2)} credits

Choose the value you want to change:`;
  await safeEdit(chatId, messageId, text, settingsKeyboard());
}

const SUPPORT_BTC_ADDRESS = "bc1q6j50emprjgnckt7cd0cfjdlxklku5emdhg4x84tfk85885tpq72sqadeet";

function demoWithdrawalText(st) {
  const rows = (st.demoWithdrawals || []).slice(0, 10);
  if (!rows.length) return "💸 DEMO WITHDRAWALS\n\nNo demo withdrawal requests yet.";
  return "💸 DEMO WITHDRAWALS\n\n" + rows.map((w, i) =>
    `${i + 1}. ${Number(w.amount).toFixed(2)} credits • ${w.status}\nTest address: ${w.address}`
  ).join("\n\n") + "\n\n⚠️ Simulation only — no real BTC is owed or sent.";
}

function supportText() {
  return `₿ SUPPORT WITH BITCOIN

BTC address:
${SUPPORT_BTC_ADDRESS}

⚠️ Support payments are separate from the roulette demo. Sending BTC here does NOT add demo credits, create a wagering balance, or create any withdrawal entitlement.`;
}

function isAdmin(userId) {
  const configured = String(process.env.ADMIN_TELEGRAM_ID || "").trim();
  const incoming = String(userId || "").trim();

  return configured.length > 0 && configured === incoming;
}

function adminQueueText(queue) {
  const rows = queue.slice(0, 10);
  if (!rows.length) return "🛠 DEMO ADMIN QUEUE\n\nNo demo withdrawal requests.";
  return "🛠 DEMO ADMIN QUEUE\n\n" + rows.map(w =>
    `${w.id} • User ${w.userId}\n${Number(w.amount).toFixed(2)} credits • ${w.status}\n${w.address}`
  ).join("\n\n") + "\n\nSimulation only. Status controls do not send BTC.";
}

function adminQueueKeyboard(queue) {
  const pending = queue.filter(w => w.status === "PENDING (DEMO)").slice(0, 4);
  const buttons = pending.map(w => [
    { text: `✅ ${w.id}`, callback_data: `wa:${w.id}` },
    { text: `❌ ${w.id}`, callback_data: `wr:${w.id}` },
    { text: `🧪 Paid ${w.id}`, callback_data: `wp:${w.id}` }
  ]);
  buttons.push([{ text: "🎰 Dashboard", callback_data: "dashboard" }]);
  return { inline_keyboard: buttons };
}

async function handleCallback(q) {
  const data = q.data;
  const userId = String(q.from.id);
  const chatId = q.message.chat.id;
  const messageId = q.message.message_id;
  let st = await getState(userId);

  await telegramApi("answerCallbackQuery", { callback_query_id: q.id });

  if (/^w[arp]:/.test(data)) {
    if (!isAdmin(userId)) return safeEdit(chatId, messageId, "⛔ Admin access required.", viewKeyboard());
    const [action, id] = data.split(":");
    let queue = await getWithdrawalQueue();
    const item = queue.find(w => w.id === id);
    if (item) {
      item.status = action === "wa" ? "APPROVED (DEMO)" : action === "wr" ? "REJECTED (DEMO)" : "MARKED PAID (DEMO)";
      item.updatedAt = Date.now();
      await saveWithdrawalQueue(queue);
      const owner = await getState(item.userId);
      const local = (owner.demoWithdrawals || []).find(w => w.id === id);
      if (local) local.status = item.status;
      // Rejected demo requests return the reserved demo credits.
      if (action === "wr" && !item.refunded) {
        owner.balance += Number(item.amount || 0);
        item.refunded = true;
        if (local) local.refunded = true;
        await saveWithdrawalQueue(queue);
      }
      await saveState(item.userId, owner);
    }
    queue = await getWithdrawalQueue();
    return safeEdit(chatId, messageId, adminQueueText(queue), adminQueueKeyboard(queue));
  }

  if (data === "dashboard") {
    st.pendingInput = null;
    await saveState(userId, st);
    return safeEdit(chatId, messageId, statusText(st), mainKeyboard(st));
  }

  if (data === "settings") {
    st.pendingInput = null;
    await saveState(userId, st);
    return showSettings(chatId, messageId, st);
  }

  if (data === "input_unit" || data === "input_target" || data === "input_stop") {
    st.pendingInput = data.replace("input_", "");
    await saveState(userId, st);
    const labels = {
      unit: ["💰 UNIT SIZE", "Type your new unit size.\n\nExample: 0.10"],
      target: ["🎯 PROFIT TARGET", "Type the profit amount that should automatically stop Auto Spin.\n\nExample: 10"],
      stop: ["🛑 STOP TARGET", "Type the maximum session loss that should automatically stop Auto Spin.\n\nExample: 20"]
    };
    const [title, body] = labels[st.pendingInput];
    return safeEdit(chatId, messageId, `${title}\n\n${body}`, {
      inline_keyboard: [[{ text: "⬅️ Cancel", callback_data: "settings" }]]
    });
  }

  if (data === "speed_turbo") {
    st.speedMs = TURBO_SPEED_MS;
    await saveState(userId, st);
    return safeEdit(chatId, messageId, statusText(st) + "\n\n⚡ Speed • TURBO", mainKeyboard(st));
  }

  if (data === "speed_normal") {
    st.speedMs = NORMAL_SPEED_MS;
    await saveState(userId, st);
    return safeEdit(chatId, messageId, statusText(st) + "\n\n⏱ Speed • NORMAL", mainKeyboard(st));
  }

  if (data === "start") {
    if (!st.running) {
      st.running = true;
      st.runId = crypto.randomUUID();
      await saveState(userId, st);
      await safeEdit(chatId, messageId, statusText(st), mainKeyboard(st));
      await launchAuto(userId, chatId, messageId, st.runId);
    } else {
      await safeEdit(chatId, messageId, statusText(st), mainKeyboard(st));
    }
    return;
  }

  if (data === "stop") {
    st.running = false;
    st.runId = null;
    await saveState(userId, st);
    return safeEdit(chatId, messageId, statusText(st), mainKeyboard(st));
  }

  if (data === "stats") {
    return safeEdit(chatId, messageId, statsText(st), viewKeyboard());
  }

  if (data === "history") {
    return safeEdit(chatId, messageId, historyText(st), viewKeyboard());
  }

  if (data === "reset") {
    st.running = false;
    st.runId = null;
    st.startBalance = st.balance;
    st.stage = 1;
    st.deficit = 0;
    st.cyclePl = 0;
    st.spins = 0;
    st.cycles = 0;
    st.wins = 0;
    st.losses = 0;
    st.peakBalance = st.balance;
    st.maxDrawdown = 0;
    st.pendingInput = null;
    st.history = [];
    await saveState(userId, st);
    return safeEdit(chatId, messageId, "✅ Session reset.\n\n" + statusText(st), mainKeyboard(st));
  }

  if (data === "btc_support") {
    return safeEdit(chatId, messageId, supportText(), {
      inline_keyboard: [
        [{ text: "₿ Open Bitcoin Wallet", url: `bitcoin:${SUPPORT_BTC_ADDRESS}` }],
        [{ text: "🎰 Dashboard", callback_data: "dashboard" }]
      ]
    });
  }

  if (data === "demo_withdraw") {
    st.pendingInput = "withdraw_amount";
    st.pendingWithdrawalAmount = null;
    await saveState(userId, st);
    return safeEdit(chatId, messageId,
      "💸 DEMO WITHDRAWAL\n\nEnter the number of DEMO credits you want to withdraw.\n\nThis is a simulation and does not create a real BTC payout entitlement.",
      { inline_keyboard: [[{ text: "⬅️ Cancel", callback_data: "dashboard" }]] }
    );
  }

  if (data === "demo_withdrawals") {
    return safeEdit(chatId, messageId, demoWithdrawalText(st), viewKeyboard());
  }

  if (data === "deposit100") {
    st.balance += 100;
    st.peakBalance = Math.max(st.peakBalance, st.balance);
    await saveState(userId, st);
    return safeEdit(chatId, messageId, "✅ Demo deposit +100 credits.\n\n" + statusText(st), mainKeyboard(st));
  }

}

async function handleText(message) {
  const userId = String(message.from.id);
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  let st = await getState(userId);

  if (text === "/start" || text === "/dashboard") {
    st.pendingInput = null;
    await saveState(userId, st);
    return telegramApi("sendMessage", {
      chat_id: chatId,
      text: statusText(st),
      reply_markup: mainKeyboard(st)
    });
  }

  if (text === "/stats") {
    return telegramApi("sendMessage", {
      chat_id: chatId,
      text: statsText(st),
      reply_markup: viewKeyboard()
    });
  }

  if (text === "/history") {
    return telegramApi("sendMessage", {
      chat_id: chatId,
      text: historyText(st),
      reply_markup: viewKeyboard()
    });
  }

  if (text === "/myid") {
  const configured = String(process.env.ADMIN_TELEGRAM_ID || "").trim();

  return telegramApi("sendMessage", {
    chat_id: chatId,
    text:
      `Your Telegram ID: ${userId}\n` +
      `Admin ID configured: ${configured ? "YES" : "NO"}\n` +
      `Admin match: ${isAdmin(userId) ? "YES" : "NO"}`
  });
}

  if (!st.pendingInput) return;

  if (st.pendingInput === "withdraw_address") {
    const addr = text.replace(/\s+/g, "");
    if (addr.length < 14 || addr.length > 90) {
      return telegramApi("sendMessage", { chat_id: chatId, text: "Enter a BTC-style TEST address for the demo request." });
    }
    const amount = Number(st.pendingWithdrawalAmount || 0);
    if (!(amount > 0) || amount > st.balance) {
      st.pendingInput = null;
      st.pendingWithdrawalAmount = null;
      await saveState(userId, st);
      return telegramApi("sendMessage", { chat_id: chatId, text: "Demo withdrawal amount is no longer available. Start the request again." });
    }
    st.balance -= amount;
    const id = `W${Date.now().toString(36).slice(-6).toUpperCase()}`;
    const request = { id, userId, amount, address: addr, status: "PENDING (DEMO)", ts: Date.now() };
    st.demoWithdrawals = [request, ...(st.demoWithdrawals || [])].slice(0, 50);
    const queue = await getWithdrawalQueue();
    await saveWithdrawalQueue([request, ...queue]);
    st.pendingInput = null;
    st.pendingWithdrawalAmount = null;
    await saveState(userId, st);
    return telegramApi("sendMessage", {
      chat_id: chatId,
      text: `✅ Demo withdrawal request recorded: ${amount.toFixed(2)} credits.\n\n⚠️ Simulation only — this does not create a real BTC payout.\n\n${statusText(st)}`,
      reply_markup: mainKeyboard(st)
    });
  }

  const value = Number(text.replaceAll("$","").replaceAll(",",""));
  if (!Number.isFinite(value) || value <= 0) {
    return telegramApi("sendMessage", {
      chat_id: chatId,
      text: "Please enter a number greater than 0. Example: 0.10"
    });
  }

  let label;
  if (st.pendingInput === "withdraw_amount") {
    if (value > st.balance) {
      return telegramApi("sendMessage", { chat_id: chatId, text: `Demo balance is only ${st.balance.toFixed(2)} credits.` });
    }
    st.pendingWithdrawalAmount = value;
    st.pendingInput = "withdraw_address";
    await saveState(userId, st);
    return telegramApi("sendMessage", {
      chat_id: chatId,
      text: `Demo withdrawal amount: ${value.toFixed(2)} credits.\n\nNow enter a BTC-style TEST address to attach to this simulated request.\n\n⚠️ No real BTC will be sent.`
    });
  } else if (st.pendingInput === "unit") {
    if (value > 10000) return telegramApi("sendMessage", { chat_id: chatId, text: "Unit size is too large." });
    st.unit = value;
    label = `💰 Unit size changed to ${value.toFixed(2)} credits.`;
  } else if (st.pendingInput === "target") {
    st.target = value;
    label = `🎯 Profit target changed to +${value.toFixed(2)} credits.`;
  } else {
    st.stoploss = value;
    label = `🛑 Stop target changed to -${value.toFixed(2)} credits.`;
  }
  st.pendingInput = null;
  await saveState(userId, st);

  return telegramApi("sendMessage", {
    chat_id: chatId,
    text: `${label}\n\n${statusText(st)}`,
    reply_markup: mainKeyboard(st)
  });
}

export default async (req) => {
  if (req.method !== "POST") return response({ ok: true, service: "telegram-webhook" });

  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== secret) return response({ ok: false }, 403);
  }

  try {
    const update = await req.json();
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message?.text) await handleText(update.message);
    return response();
  } catch (e) {
    console.error(e);
    // Return 200 so Telegram does not repeatedly redeliver an update that caused an app bug.
    return response({ ok: false, error: String(e.message || e) });
  }
};

export const config = {
  path: "/telegram",
  method: ["GET", "POST"]
};
