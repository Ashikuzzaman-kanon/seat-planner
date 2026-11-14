/** Formats an amount of taka, e.g. 1250 -> "1,250 taka". Used by paths.js. */
function taka(amount) {
  return `${amount.toLocaleString("en-US")} taka`;
}

module.exports = { taka };
