// Hotfix content — the "realistic editing" mode. Each level is a code buffer
// plus a queue of tickets: a plain-words instruction, a highlighted target
// cell, and canonical `ideal` keys. The expected buffer after each ticket is
// DERIVED by replaying the ideal chain, so any technique that produces the
// same text counts; `after` pins the final buffer so a unit test catches
// authoring mistakes in the chain.

export interface HotfixTask {
  /** Ticket text shown in the HUD — what to do, in plain words. */
  desc: string;
  /** Where the fix happens — highlighted until this ticket is closed.
   *  Authored against the buffer state when the ticket opens. */
  target: { row: number; col: number };
  /** Canonical solution, replayed from the previous ticket's end state. */
  ideal: string;
}

export interface HotfixLevel {
  id: string;
  title: string;
  skill: string;
  hint: string;
  buffer: string[];
  tasks: HotfixTask[];
  /** Expected buffer after ALL tickets — validates the ideal chain in tests. */
  after: string[];
  startTime: number; // seconds on the deploy clock at start
  bonusTime: number; // seconds refunded per closed ticket
}

export const HOTFIX_LEVELS: HotfixLevel[] = [
  {
    id: "hotfix-shift",
    title: "First Shift",
    skill: "edit, Esc, repeat",
    hint: "Read the ticket, jump there, fix it, Esc back to normal. Every fix buys time — ship with :wq.",
    buffer: [
      "let total = 0;",
      "const items = [];",
      "function add(item) {",
      "  items.push(item)",
      "  total += item.pric;",
      "  console.log('debug add', item);",
      "}",
      "// TODO remove tax hack",
      "const TAX = 0.2;",
    ],
    tasks: [
      {
        desc: "Line 4 is missing its semicolon — append a ; at the end.",
        target: { row: 3, col: 17 },
        ideal: "4GA;<Esc>",
      },
      {
        desc: "Typo on line 5: 'pric' should be 'price'.",
        target: { row: 4, col: 16 },
        ideal: "5Gfpciwprice<Esc>",
      },
      {
        desc: "QA found a leftover debug log on line 6 — delete the whole line.",
        target: { row: 5, col: 2 },
        ideal: "6Gdd",
      },
      {
        desc: "Tax went up: make the 0.2 on line 8 read 0.25.",
        target: { row: 7, col: 14 },
        ideal: "8G$i5<Esc>",
      },
      {
        desc: "Persist the cart: add 'save()' on a new line at the very bottom.",
        target: { row: 7, col: 0 },
        ideal: "Gosave()<Esc>",
      },
    ],
    after: [
      "let total = 0;",
      "const items = [];",
      "function add(item) {",
      "  items.push(item);",
      "  total += item.price;",
      "}",
      "// TODO remove tax hack",
      "const TAX = 0.25;",
      "save()",
    ],
    startTime: 60,
    bonusTime: 6,
  },
  {
    id: "hotfix-crunch",
    title: "Crunch Time",
    skill: "surgical strikes",
    hint: "Text objects and precision tools: ci\" rewrites a string, dt) trims args, r swaps one char.",
    buffer: [
      "function greet(name) {",
      '  const msg = "helo world";',
      "  print(msg, name, debug);",
      "  return msg;;",
      "}",
      'const mode = "dev";',
      "const retries = 1;",
      "// deploy friday",
    ],
    tasks: [
      {
        desc: 'The greeting on line 2 is wrong — change the string to "hello".',
        target: { row: 1, col: 15 },
        ideal: '2Gf"ci"hello<Esc>',
      },
      {
        desc: "print() takes two args — delete ', debug' from line 3.",
        target: { row: 2, col: 17 },
        ideal: "3G$F,dt)",
      },
      {
        desc: "Doubled semicolon on line 4 — kill one of them.",
        target: { row: 3, col: 13 },
        ideal: "4G$x",
      },
      {
        desc: 'Going live: flip mode on line 6 from "dev" to "prod".',
        target: { row: 5, col: 14 },
        ideal: '6Gf"ci"prod<Esc>',
      },
      {
        desc: "The network is flaky — bump retries on line 7 from 1 to 3.",
        target: { row: 6, col: 16 },
        ideal: "7Gf1r3",
      },
      {
        desc: "Schedule slipped: on line 8, change 'friday' to 'now'.",
        target: { row: 7, col: 10 },
        ideal: "8Gffciwnow<Esc>",
      },
    ],
    after: [
      "function greet(name) {",
      '  const msg = "hello";',
      "  print(msg, name);",
      "  return msg;",
      "}",
      'const mode = "prod";',
      "const retries = 3;",
      "// deploy now",
    ],
    startTime: 65,
    bonusTime: 6,
  },
  {
    id: "hotfix-prod",
    title: "Prod Is Down",
    skill: "search, :s and .",
    hint: "Long-range fixes: / flies to the problem, :%s renames everywhere, . repeats your last edit.",
    buffer: [
      "const conf = { retry: false, log: 'quiet' };",
      "function fetchUser(id) {",
      "  const url = base + '/user/' + id;",
      "  return http.get(url).then(parse.data);",
      "}",
      "function fetchOrder(id) {",
      "  const url = base + '/order/' + id;",
      "  return http.get(url).then(parse.data);",
      "}",
      "alert('panic'); alert('panic'); alert('panic');",
    ],
    tasks: [
      {
        desc: "Requests give up instantly — search /false and change it to true.",
        target: { row: 0, col: 22 },
        ideal: "/false<CR>ciwtrue<Esc>",
      },
      {
        desc: "parse.data was renamed — :%s/parse.data/parseData/g fixes every call.",
        target: { row: 3, col: 28 },
        ideal: ":%s/parse.data/parseData/g<CR>",
      },
      {
        desc: "API v2: make '/user/' on line 3 read '/v2/user/'.",
        target: { row: 2, col: 23 },
        ideal: "/user<CR>iv2/<Esc>",
      },
      {
        desc: "Same fix for '/order/' on line 7 — jump there and let . repeat it.",
        target: { row: 6, col: 23 },
        ideal: "/order<CR>.",
      },
      {
        desc: "Someone left a panic line at the very bottom — G, then delete it.",
        target: { row: 9, col: 0 },
        ideal: "Gdd",
      },
    ],
    after: [
      "const conf = { retry: true, log: 'quiet' };",
      "function fetchUser(id) {",
      "  const url = base + '/v2/user/' + id;",
      "  return http.get(url).then(parseData);",
      "}",
      "function fetchOrder(id) {",
      "  const url = base + '/v2/order/' + id;",
      "  return http.get(url).then(parseData);",
      "}",
    ],
    startTime: 75,
    bonusTime: 7,
  },
];
