import {
  getState, saveState, executeSpin, statusText, mainKeyboard,
  safeEdit, sleep, TURBO_SPEED_MS
} from "./common.mjs";

export default async (req) => {
  let body;
  try { body = await req.json(); }
  catch { return; }

  const { userId, chatId, messageId, runId } = body || {};
  if (!userId || !chatId || !messageId || !runId) return;

  // Background Functions have a 15-minute hard limit.
  // Stop a little early so the final Telegram edit can complete.
  const deadline = Date.now() + 13.5 * 60 * 1000;

  while (Date.now() < deadline) {
    const current = await getState(userId);
    if (!current.running || current.runId !== runId) return;

    const { state, result, reason, stopped } = await executeSpin(userId, runId);

    if (result) {
      await safeEdit(chatId, messageId, statusText(state, result, reason), mainKeyboard(state));
    } else if (reason) {
      await safeEdit(chatId, messageId, statusText(state, null, reason), mainKeyboard(state));
    }

    if (stopped || reason || !state.running || state.runId !== runId) return;

    // Telegram message editing is rate-limited; Netlify Turbo uses 0.5s instead of 0.25s.
    const delay = Math.max(state.speedMs || 2000, TURBO_SPEED_MS);
    await sleep(delay);
  }

  const st = await getState(userId);
  if (st.running && st.runId === runId) {
    st.running = false;
    st.runId = null;
    await saveState(userId, st);
    await safeEdit(
      chatId,
      messageId,
      "⏱ Netlify Auto session reached its cloud execution window.\nPress Start Auto to continue.\n\n" + statusText(st),
      mainKeyboard(st)
    );
  }
};

export const config = {
  path: "/.netlify/functions/autospin-background",
  background: true,
  method: "POST"
};
