ROULETTE TELEGRAM DEMO BOT — NETLIFY V1
=======================================

WHAT THIS VERSION DOES
----------------------
• No Windows desktop program needs to stay running.
• Telegram uses a webhook hosted on Netlify.
• User balances/settings/history are persisted with Netlify Blobs.
• Stationary live dashboard: Auto Spin edits one Telegram message.
• Normal and Turbo speed.
• User-entered Unit Size, Profit Target, and Stop Target.
• Stats, History, Reset, demo Deposit and demo Withdraw.
• Same four-step European roulette strategy as the V8 desktop demo.

IMPORTANT
---------
This is a PLAY-MONEY / DEMO simulator. It does not receive real Bitcoin,
does not connect to a sportsbook/casino, and does not place real wagers.

NETLIFY AUTO-SPIN LIMIT
-----------------------
Netlify Background Functions have a hard 15-minute execution limit.
This project runs an Auto session for about 13.5 minutes, then stops cleanly.
Press "Start Auto" again to continue.

Turbo is set to 0.5 seconds per spin in this cloud edition to reduce the risk
of Telegram message-edit rate limiting.

DEPLOYMENT
----------
Recommended: put this folder in a GitHub repository and connect the repository
to Netlify (Add new project -> Import an existing project).

Build settings are already in netlify.toml.
Netlify will run npm install and deploy the files/functions.

AFTER THE FIRST DEPLOY
----------------------
In Netlify:
Project configuration -> Environment variables

Create these variables:

1) TELEGRAM_BOT_TOKEN
   Your NEW BotFather token.
   Do not put it in source code and do not share it in chat.

2) WEBHOOK_SECRET
   Make up a long random secret, letters/numbers/_/-
   Example format only: my_private_webhook_secret_928374

3) SETUP_KEY
   Make up another private random value.
   This protects the one-time setup URL.

After adding/changing environment variables, trigger a new deploy so the
Functions receive them.

REGISTER THE TELEGRAM WEBHOOK
-----------------------------
After the redeploy, open this address in your browser:

https://YOUR-SITE.netlify.app/setup-webhook?key=YOUR_SETUP_KEY

Replace YOUR-SITE and YOUR_SETUP_KEY with your own values.

You should receive JSON similar to:
{
  "ok": true,
  "message": "Telegram webhook configured.",
  "webhook": "https://YOUR-SITE.netlify.app/telegram"
}

Then open your bot in Telegram and send:

/start

TROUBLESHOOTING
---------------
If /start does nothing:
• Netlify -> Logs & Metrics -> Functions -> telegram
• Check TELEGRAM_BOT_TOKEN is correct.
• Open /setup-webhook?key=... again after any token/site change.
• Make sure you redeployed after changing environment variables.

If Auto Spin starts but later stops:
That is expected after roughly 13.5 minutes because Netlify Background
Functions can run for at most 15 minutes. Press Start Auto to continue.

If you see Telegram "message is not modified":
The project already ignores that harmless error.

FILES
-----
public/index.html                         Site status page
netlify/functions/telegram.mjs            Telegram webhook/controller
netlify/functions/autospin-background.mjs Auto Spin background worker
netlify/functions/common.mjs              Strategy/state/display functions
netlify/functions/setup-webhook.mjs       One-time webhook registration
netlify.toml                              Netlify configuration
package.json                              Node dependency configuration


V2 EXACT-RECOVERY STRATEGY UPDATE
--------------------------------
The previous 4-step Column/number recovery has been replaced with the exact alternating recovery system from roulette_red_dozens_exact_recovery_v7_drawdown_chart.html.

Progression: 1 -> 2 -> 3 -> 12 -> 18 -> 72 -> 108 -> 432 ...
Odd levels: Red.
Even levels: 2nd + 3rd Dozens, total stake split equally.
Any winning recovery spin resets to Level 1 (1 unit Red).
Default recovery risk guard: 35% of current demo bankroll.
Existing users are automatically migrated to Level 1 while preserving their demo balance and settings.
