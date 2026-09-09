import crypto from "node:crypto";
import {
  getState, saveState, statusText, statsText, historyText,
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

async function handleCallback(q) {
  const data = q.data;
  const userId = String(q.from.id);
  const chatId = q.message.chat.id;
  const messageId = q.message.message_id;
  let st = await getState(userId);

  await telegramApi("answerCallbackQuery", { callback_query_id: q.id });

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

  if (data === "deposit100") {
    st.balance += 100;
    st.peakBalance = Math.max(st.peakBalance, st.balance);
    await saveState(userId, st);
    return safeEdit(chatId, messageId, "✅ Demo deposit +100 credits.\n\n" + statusText(st), mainKeyboard(st));
  }

  if (data === "withdraw100") {
    if (st.balance < 100) {
      return safeEdit(chatId, messageId, "⛔ Demo balance is below 100 credits.\n\n" + statusText(st), mainKeyboard(st));
    }
    st.balance -= 100;
    await saveState(userId, st);
    return safeEdit(chatId, messageId, "✅ Demo withdrawal -100 credits.\n\n" + statusText(st), mainKeyboard(st));
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

  if (!st.pendingInput) return;

  const value = Number(text.replaceAll("$","").replaceAll(",",""));
  if (!Number.isFinite(value) || value <= 0) {
    return telegramApi("sendMessage", {
      chat_id: chatId,
      text: "Please enter a number greater than 0. Example: 0.10"
    });
  }

  let label;
  if (st.pendingInput === "unit") {
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
