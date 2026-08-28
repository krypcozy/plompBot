cd "C:/Users/HP/Desktop/plomp-chronicles-bot"
npm start# Plomp Chronicles Bot

Telegram engagement bot for the PLOMP community. Tracks two separate leaderboards (story participation vs. general activity), runs Fast Typing and Keeper's Riddle mini-games, and gives you clean, exportable standings so **you** decide and send the actual rewards — the bot never touches a wallet.

## Stack

Node.js + [Telegraf](https://telegraf.js.org/), JSON file storage (no database to host). Matches your usual setup.

## Setup

1. **Create your bot** — message [@BotFather](https://t.me/BotFather) on Telegram, run `/newbot`, follow the prompts, copy the token it gives you.
2. **Install dependencies**
   ```
   npm install
   ```
3. **Configure**
   ```
   cp .env.example .env
   ```
   Paste your bot token into `.env`.
4. **Set yourself as admin** — open `config/settings.json` and replace `123456789` in `adminIds` with your actual numeric Telegram user ID (not your @username). If you don't know it, message [@userinfobot](https://t.me/userinfobot) and it'll tell you.
5. **Run it**
   ```
   npm start
   ```
6. Add the bot to your group, give it permission to read messages (disable Privacy Mode via BotFather → your bot → Bot Settings → Group Privacy → Turn Off), and it's live.

## How it works

### Two leaderboards
- **Chronicles** — XP from story engagement: Keeper's Riddle answers, future chapter quizzes/missions.
- **Community** — XP from general chat activity: messages, streaks.

Both track **lifetime XP** (never resets) and **season XP** (resets on `/resetseason`, archived automatically).

### XP values
All in `config/settings.json` under `"xp"` — edit directly, or use `/setxp <key> <value>` in Telegram. Nothing is hardcoded.

### Anti-spam
Configured in `config/settings.json` under `"antiSpam"`:
- `cooldownSeconds` — minimum gap between XP-earning messages per user
- `minMessageLength` / `minWordCount` — filters out low-effort one-word messages
- `dailyXpCap` — hard ceiling on community XP per user per day
- A built-in pattern also blocks common zero-effort spam ("gm", "wagmi", emoji-only, etc.)

None of this blocks messages from being sent — it just decides whether a message earns XP.

### Games

**Fast Typing** — admin runs `/fasttyping`, bot posts a random lore-flavored phrase, first person to retype it exactly wins XP. Phrase pool lives in `src/games/fastTyping.js` — add more anytime.

**Keeper's Riddle** — admin runs `/riddle` (optionally `/riddle III` for a specific chapter), bot posts a question sourced from `data/keepers-riddle.json`. First correct answer gets a bonus; everyone who answers correctly within the time window gets base XP. To add riddles for future chapters, just append to that JSON file — no code changes needed.

**Ashborn Trial** — admin runs `/trial`. Bot chains 4 rapid-fire questions from the same riddle bank, one round at a time (20s each by default), auto-advancing whether or not anyone answers. First correct per round gets a small bonus; a completion bonus goes to anyone who scored at least once. Good for a livelier, faster-paced event vs. the single-question Keeper's Riddle.

**Connect Four** — any group member runs `/connectfour`. The first two players join from the challenge message, then take alternating turns by choosing a column. Four connected tokens wins; turns expire after 60 seconds. A rematch between the same players within 30 minutes still plays but does not award XP.

**Hidden Clue Drops** — no command, by design. On any normal eligible message, there's a small configurable chance (`hiddenClue.triggerChance`, default 1%) the bot posts an unprompted "⚠️ SECRET QUESTION" — first correct answer wins a bonus. Rate-limited hard: `minGapHours` (default 3h) between drops and `maxPerDay` (default 2) so it stays a rare "people are watching the chat" moment, not a recurring interruption.

### Weekly Digest (leaderboard auto-post + Mystery Box, combined)

Rather than separate leaderboard and Mystery Box posts (which gets spammy fast), the bot sends **one combined weekly message**: top 5 on both leaderboards, plus a Mystery Box shout-out to whoever's #1 on Chronicles that week. No auto-payout — it just names them so you know who to reward.

- Set the schedule in `config/settings.json` under `"weeklyDigest"` (`dayOfWeek`: 0=Sunday...6=Saturday, `hourUTC`).
- Run `/setchat` once in the group you want it posted to — the bot registers that chat as the destination.
- Test anytime with `/digest` (admin-only) to post it immediately without waiting for the schedule.
- It checks every 5 minutes in the background and won't double-post within the same week.


### Rewards — manual, by design
The bot **never sends crypto**. When you're ready to distribute rewards:
```
/export chronicles
/export community
```
This drops a CSV (rank, name, Telegram ID, XP, faction) you can use to pay out manually.

## Commands

**Players**
| Command | What it does |
|---|---|
| `/profile` | Your Plomper profile card |
| `/leaderboard chronicles\|community` | This season's top 10 |
| `/lifetimeboard chronicles\|community` | All-time top 10 |
| `/setfaction <Green Order\|Black Tide\|Ashborn\|Keepers>` | Pledge a faction |
| `/connectfour` | Start a Connect Four challenge in a group |

**Admin only** (must be in `adminIds`)
| Command | What it does |
|---|---|
| `/fasttyping` | Start a Fast Typing challenge |
| `/riddle [chapter]` | Start a Keeper's Riddle |
| `/trial` | Start an Ashborn Trial (4 chained rapid-fire questions) |
| `/setchat` | Register this chat to receive the weekly digest |
| `/digest` | Manually post the weekly leaderboard + Mystery Box digest right now (for testing) |
| `/addxp <chronicles\|community> <amount>` | Reply to a user's message to grant XP manually |
| `/setxp <key> <value>` | Change any XP value on the fly |
| `/resetseason` | Archive current season, reset season boards, start fresh (lifetime XP untouched) |
| `/export chronicles\|community` | Download the season leaderboard as CSV |

## File structure

```
plomp-chronicles-bot/
  src/
    bot.js              entry point — all commands + message handler
    db.js                atomic JSON file read/write helper
    users.js              user data model
    xpEngine.js            XP awarding + daily cap + streaks
    antiSpam.js             cooldown/duplicate/quality filtering
    leaderboards.js          season + lifetime boards, CSV export
    profile.js                /profile formatting
    season.js                  season archive/reset
    scheduler.js                 weekly digest (leaderboard + mystery box)
    games/
      fastTyping.js              Fast Typing mini-game
      connectFour.js             Connect Four mini-game
      keepersRiddle.js            Keeper's Riddle mini-game
      ashbornTrial.js               Ashborn Trial (chained rounds)
      hiddenClue.js                  Hidden Clue Drops (rare, unprompted)
  config/
    settings.json          all XP values, anti-spam tuning, admin IDs, schedules
  data/
    users.json              live user records (auto-created/updated)
    keepers-riddle.json      riddle question bank (edit to add more)
    season-archives/          auto-saved snapshot each time you /resetseason
    exports/                   CSVs land here when you run /export
    schedulerState.json         tracks when the weekly digest last posted
    hiddenClueState.json         tracks Hidden Clue drop rate limiting
```

## What's next / not built yet

Not yet built (straightforward to bolt on later using the same patterns):
- Chapter-specific missions / daily missions
- "Find the Plomp" hidden-image game
- Black Tide Attack faction-choice event (ATTACK/DEFEND/ESCAPE)
- Multi-step Keeper's Puzzle chains
- Referral/invite XP

All of these can reuse `xpEngine.js` and the same admin-trigger or rare-drop pattern already established.
