import { telegramApi } from "./common.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const setupKey = process.env.SETUP_KEY;

  if (!setupKey || key !== setupKey) {
    return new Response("Invalid setup key.", { status: 403 });
  }

  const base = process.env.URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!base) return new Response("Netlify URL environment variable is missing.", { status: 500 });

  try {
    const payload = {
      url: `${base}/telegram`,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true
    };
    if (secret) payload.secret_token = secret;

    await telegramApi("setWebhook", payload);
    const info = await telegramApi("getWebhookInfo", {});
    return Response.json({
      ok: true,
      message: "Telegram webhook configured.",
      webhook: info.url,
      pending_update_count: info.pending_update_count
    });
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
};

export const config = {
  path: "/setup-webhook",
  method: "GET"
};
