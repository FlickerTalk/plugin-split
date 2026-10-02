# plugin-split

**Split** for [FlickerTalk](https://flickertalk.com): shared expenses between two people — who
paid what and who owes whom — kept on each phone and joined live from a conversation.

## What it does

- **Several accounts** on the phone ("Lisbon trip", "Flat"), each in **one currency**, chosen from
  the currencies the phone's `Intl` knows.
- **An expense**: the amount, what it was for, **who paid** (I, or the other person) and how it
  splits: **half each**, or **all of it for the one who did not pay**. Amounts can be typed with a
  decimal comma or a decimal point (`12,50` or `12.50`).
- **The balance**, from your side: "Owes you €12.50", "You owe €12.50" or "All square ✅".
- **💸 Settle up** records that the one who owes paid the balance, after asking inside the plugin.
- **For two people.** Split knows no names: it says "I" and "the other person", or the nickname
  each one gives themselves. "I paid" on one phone is "the other person paid" on the other.
- **🔄 Live**, from a conversation: the same account on both phones, each change on the other phone
  as it happens. The limit, said in the plugin: changes join only while **both** have the account
  open in that conversation. If the other phone does not answer within about 8 seconds, Split
  says so; it cannot tell whether the other person does not have Split, did not allow it, or has
  it closed, and it never claims that a change arrived when it did not.
- **Apart, then together**: what each one does with no connection, or with Split closed, is kept on
  each phone and joins the other's the next time both have the account open. A deletion on one
  phone and an edit of the same expense on the other end up deleted on both.
- **📤** puts a summary in the conversation's composer, for you to send, written from your side and
  in your language:

  ```text
  🧾 Lisbon · total €312.40 · I paid €200.00 · you €112.40 · you owe me €43.80
  ```

- **21 languages**, right to left in Arabic, dark mode.

Not in this version: more than two people, uneven splits, several currencies or exchange rates
(they would need the network), receipts, categories, export.

## Money

Amounts are whole numbers of the currency's minor unit (cents, fils…), never floating-point
numbers. How many decimals a currency has comes from `Intl.NumberFormat(…).resolvedOptions()`: none
for JPY, two for EUR, three for KWD. In a half split of an odd amount, the one who paid puts the odd
cent. An amount with more decimals than its currency has is refused, never rounded. Everything
shown goes through `Intl` in the phone's language. For two people and one currency per account this
is all it takes, so no money library (dinero.js, currency.js) is used.

## Privacy

The accounts live on your phones, with no sign-up and nothing stored on our server; changes travel
encrypted over the direct connection.

- Split sees its own accounts. It never sees the conversation, who the contact is, any payment
  data, or anything else on the phone, and it has no network.
- Live messages go through the core's `ft.live`: only over the direct connection between the two
  phones, end-to-end encrypted like every message, never through the mailbox. If the connection is
  relayed by our TURN server, the server sees that there is traffic, never its content.
- Going live may wake the other phone with a push that carries no content.
- What 📤 puts in the composer and you send is a message like any other.

## What it uses of the core

| Capability   | What for                                                                      |
| ------------ | ----------------------------------------------------------------------------- |
| `ft.records` | each account in two records, `split/<id>/meta` and `split/<id>/body`, written on every change (`storage: small`, 4 MB) |
| `ft.live`    | live editing, 1 to 1, in messages of at most 48 KiB (bigger ones go in parts) |
| `ft.say`     | 📤 (`send: propose`: the text lands in the composer and you send it)          |
| `onOpen`     | `lang`, and `live` (true only from a conversation, with live allowed)         |

Permissions: `{ "live": true, "send": "propose" }`. Needs FlickerTalk core **1.1.0**
(`minCoreVersion`). The contract is in [plugin-sdk](https://github.com/FlickerTalk/plugin-sdk).

## How an account is kept

A [Yjs](https://github.com/yjs/yjs) document. `info` holds `name`, `currency` and `schema`;
`expenses` is a map of id → map with `amount` (minor units), `what`, `paid`, `split` (`half` or
`all`), `kind` (`expense` or `settle`), `at` and, once deleted, `gone: true` (an entry is marked,
never removed, so an edit made meanwhile on the other phone cannot bring it back); `people` holds
each participant's nickname by participant id. `paid` is the payer's participant id, or `!` and
the id of the phone that wrote it when the payer was "the other person" (whose id that phone may
not know yet). Two phones that settle the same balance while apart write the same entry, so it
counts once. An account with a higher `schema` than this plugin knows, or a currency `Intl` does
not know, opens read only. The body record is the whole document as one Yjs update in base64; the
meta record is JSON with the name, the currency, the balance from this phone's side, and this
phone's side of the live session (`who`, `peer`, `shared`).

## The live protocol

The common protocol of FlickerTalk's plugins that edit something between two phones, as in
[plugin-list](https://github.com/FlickerTalk/plugin-list), with format `p: "ftsplit"`. Each message
is an envelope, JSON → UTF-8 → base64:

```json
{ "p": "ftsplit", "v": 1, "k": "hello", "doc": "<account id>", "who": "<participant id>", "app": "1.0.0" }
```

Kinds `hello`, `sync`, `update`, `part` and `bye`; ids of 1 to 64 characters of
`A-Z a-z 0-9 _ -`; a message with a higher `v` is not applied and the plugin says to update. These
files are copied from plugin-list unchanged:

| File | What |
| --- | --- |
| `src/live.js`, `test/live.test.js` | envelope, parts, versions, `Inbox`, `LiveSession`, `inOrder` |
| `src/live-yjs.js`, `test/live-yjs.test.js` | a Yjs document as the replica |
| `src/i18n.js`, `test/i18n.test.js` | the 21 languages, holes, RTL, the catalogue check |
| `test/fake-core.js` | the fake core, and two of them joined as two phones |

## Development

```sh
npm install
npm run build     # esbuild: src/ → dist/index.js, and THIRD_PARTY_NOTICES.md beside it
npm test          # Vitest + happy-dom: money, the account, the records, the view, two phones
```

`dist/` is generated and **committed**: what the catalogue signs is `module.json` + `dist/`. Run
the build before the tests: they check that `dist/` stays under 400 KB, holds no web address and
nothing the plugin frame forbids, and runs. The CI checks too that `dist/` comes from `src/`, and
the licences of the dependencies.

## Licence

MIT. The bundle contains Yjs and lib0 (MIT); their licences are in `THIRD_PARTY_NOTICES.md`.
