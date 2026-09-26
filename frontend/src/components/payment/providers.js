/**
 * The simulated payment providers.
 *
 * Every name here is invented. None of them is a near-miss of a real brand, on
 * purpose: a fake checkout that looked like somebody's actual payment provider
 * would be a phishing screen with a wink, and the wink does not travel well in
 * a screenshot. These are unmistakably jokes.
 *
 * The whole point of the flow is contrast. Paying by wallet is one click; this
 * is four screens, a PIN, a security question and a progress bar. That is
 * roughly what real gateway checkout feels like, and feeling it is the argument
 * for keeping credit in the wallet.
 */

export const PROVIDER_KINDS = [
  { key: "mfs", label: "Mobile money" },
  { key: "bank", label: "Internet banking" },
  { key: "card", label: "Card" },
];

export const PROVIDERS = [
  /* ---------------- Mobile money ---------------- */
  {
    id: "goatcash",
    kind: "mfs",
    name: "GoatCash",
    emoji: "🐐",
    tagline: "Payments that wander in eventually",
    colour: "#0f766e",
    field: { label: "GoatCash number", placeholder: "01XXXXXXXXX", mode: "tel" },
    secret: { label: "4-digit PIN", placeholder: "any four digits" },
  },
  {
    id: "mangomoney",
    kind: "mfs",
    name: "MangoMoney",
    emoji: "🥭",
    tagline: "The sweetest transfers in the district",
    colour: "#c2410c",
    field: { label: "Registered mobile", placeholder: "01XXXXXXXXX", mode: "tel" },
    secret: { label: "Secret PIN", placeholder: "any four digits" },
  },
  {
    id: "tortoisepay",
    kind: "mfs",
    name: "TortoisePay",
    emoji: "🐢",
    tagline: "Slow and steady clears the payment",
    colour: "#4d7c0f",
    field: { label: "Shell number", placeholder: "01XXXXXXXXX", mode: "tel" },
    secret: { label: "PIN", placeholder: "any four digits" },
  },
  {
    id: "duckpay",
    kind: "mfs",
    name: "DuckPay",
    emoji: "🦆",
    tagline: "Quack now, pay now, quack again",
    colour: "#a16207",
    field: { label: "Pond ID", placeholder: "01XXXXXXXXX", mode: "tel" },
    secret: { label: "Quack code", placeholder: "any four digits" },
  },

  /* ---------------- Banks ---------------- */
  {
    id: "slothbank",
    kind: "bank",
    name: "Sloth Bank",
    emoji: "🦥",
    tagline: "Your money. Eventually.",
    colour: "#7c3aed",
    field: { label: "Account number", placeholder: "any digits at all", mode: "numeric" },
    secret: { label: "Internet banking password", placeholder: "anything, truly" },
  },
  {
    id: "elephanttrust",
    kind: "bank",
    name: "Elephant Trust",
    emoji: "🐘",
    tagline: "We never forget your balance",
    colour: "#334155",
    field: { label: "Customer ID", placeholder: "whatever you remember", mode: "text" },
    secret: { label: "Password", placeholder: "we will not check" },
  },
  {
    id: "brickbank",
    kind: "bank",
    name: "First National Bank of Brick",
    emoji: "🧱",
    tagline: "Solid. Immovable. Closed on Fridays.",
    colour: "#b45309",
    field: { label: "Account number", placeholder: "any digits", mode: "numeric" },
    secret: { label: "Password", placeholder: "anything" },
  },

  /* ---------------- Cards ---------------- */
  {
    id: "jokercard",
    kind: "card",
    name: "JokerCard",
    emoji: "🃏",
    tagline: "Wild at every checkout",
    colour: "#be123c",
    field: { label: "Card number", placeholder: "16 digits, or fewer, we are relaxed", mode: "numeric" },
    secret: { label: "CVV", placeholder: "three of your favourite digits" },
  },
  {
    id: "platinumpretend",
    kind: "card",
    name: "Platinum Pretend",
    emoji: "🎩",
    tagline: "All the prestige, none of the credit",
    colour: "#1e293b",
    field: { label: "Card number", placeholder: "as long as you like", mode: "numeric" },
    secret: { label: "CVV", placeholder: "any three digits" },
  },
  {
    id: "octopuscard",
    kind: "card",
    name: "Octopus Express",
    emoji: "🐙",
    tagline: "Eight ways to pay, none of them quick",
    colour: "#0369a1",
    field: { label: "Card number", placeholder: "any digits", mode: "numeric" },
    secret: { label: "CVV", placeholder: "any three digits" },
  },
];

/**
 * The security question, which accepts anything.
 *
 * Real ones are answered with a name, a school or a pet — facts that leak out of
 * a social media profile in about a minute. These are unanswerable by anyone,
 * including the account holder, which is at least honest about how much
 * security the question was providing.
 */
export const CHALLENGES = [
  "Name a bird that owes you money.",
  "How many cups of cha have you had today? Nobody is judging. Much.",
  "What sound does your wallet make when it is empty?",
  "If your money could talk, what would it complain about first?",
  "Which came first: the chicken, the egg, or the transaction fee?",
  "What is the airspeed velocity of an unladen taka?",
  "Describe your relationship with your bank in one word.",
  "What would you name a train, if the naming were left to you?",
  "Your account balance is feeling shy today. Reassure it.",
  "Name something you have queued for longer than this checkout.",
];

/** Progress lines, because a spinner alone says nothing. */
export const PROCESSING_STEPS = [
  "Waking the server…",
  "Consulting the ledger…",
  "Asking the money nicely…",
  "Counting on fingers…",
  "Verifying you are not a goat…",
  "Almost certainly nearly done…",
];

export const providerById = (id) => PROVIDERS.find((p) => p.id === id) || null;

/** A different question each time, so the joke does not wear out in one session. */
export const randomChallenge = () =>
  CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
