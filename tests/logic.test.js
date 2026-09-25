const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

vm.runInThisContext(fs.readFileSync(require('path').join(__dirname, '../dist/logic.js'), 'utf8'));

const score = (han, fu, limit = 'normal', yakumanMultiplier = 1) => ({ han, fu, limit, yakumanMultiplier });
const rules = RW.clone(RW.DEFAULT_CONFIG.rules);

function game(mode = 'yonma', length = 'hanchan') {
  const c = RW.clone(RW.DEFAULT_CONFIG);
  c.mode = mode;
  c.gameLength = length;
  return RW.createGame(c, 1);
}

// Base / limit calculation
assert.equal(RW.calculateBase(score(3, 40), rules).base, 1280);
assert.equal(RW.ronPoints(1280, false), 5200);
assert.equal(RW.ronPoints(1280, true), 7700);
assert.equal(RW.calculateBase(score(4, 30), rules).base, 2000); // kiriage mangan
assert.equal(RW.calculateBase(score(13, 30), rules).base, 8000); // kazoe yakuman
assert.equal(RW.calculateBase(score(1, 30, 'yakuman', 3), rules).base, 24000); // multiple yakuman

// Yonma child tsumo 3han40fu: dealer 2600, children 1300 each => 5200 total
{
  const g = game('yonma');
  const r = RW.settleTsumo(g, 1, score(3, 40), rules);
  assert.deepEqual(r.deltas, [-2600, 5200, -1300, -1300]);
  assert.equal(g.kyoku, 2);
  assert.equal(g.honba, 0);
}

// Sanma tsumo loss: child gets only 3900 (2600 + 1300)
{
  const g = game('sanma');
  const r = RW.settleTsumo(g, 1, score(3, 40), rules);
  assert.deepEqual(r.deltas, [-2600, 3900, -1300]);
}

// Sanma honba: each payer adds 100, total honba bonus 200
{
  const g = game('sanma');
  g.honba = 1;
  const r = RW.settleTsumo(g, 0, score(3, 40), rules);
  assert.deepEqual(r.deltas, [5400, -2700, -2700]);
  assert.equal(g.honba, 2); // dealer repeats
}

// Ron honba remains 300 per honba
{
  const g = game('sanma');
  g.honba = 2;
  const r = RW.settleRon(g, [{ winner: 1, score: score(3, 40) }], 2, rules);
  assert.equal(r.deltas[1], 5800); // 5200 + 600
  assert.equal(r.deltas[2], -5800);
}

// Riichi stick is carried through draw and awarded on win
{
  const g = game('yonma');
  RW.declareRiichi(g, 2);
  assert.equal(g.riichiSticks, 1);
  RW.settleDraw(g, [0]);
  assert.equal(g.riichiSticks, 1);
  const r = RW.settleRon(g, [{ winner: 0, score: score(1, 30) }], 1, rules);
  assert.ok(r.deltas[0] >= 1000);
  assert.equal(g.riichiSticks, 0);
}

// Yonma draw: two tenpai split +1500 each, two noten -1500 each
{
  const g = game('yonma');
  const r = RW.settleDraw(g, [0, 2]);
  assert.deepEqual(r.deltas, [1500, -1500, 1500, -1500]);
  assert.equal(g.honba, 1);
  assert.equal(g.dealerIndex, 0); // dealer was tenpai
}

// Sanma draw: one tenpai gets +3000, two noten -1500 each
{
  const g = game('sanma');
  const r = RW.settleDraw(g, [1]);
  assert.deepEqual(r.deltas, [-1500, 3000, -1500]);
  assert.equal(g.dealerIndex, 1); // dealer was not tenpai, dealer moves
  assert.equal(g.honba, 1);
}

// Multiple ron when atamahane OFF; each winner can have a different hand value.
{
  const g = game('yonma');
  const multi = { ...rules, atamahane: false };
  const r = RW.settleRon(g, [
    { winner: 1, score: score(1, 30) },
    { winner: 2, score: score(3, 40) },
  ], 3, multi);
  assert.equal(r.deltas[1], 1000);
  assert.equal(r.deltas[2], 5200);
  assert.equal(r.deltas[3], -6200);
}

// Head bump ON selects the nearest winner in turn order from discarder.
{
  const g = game('yonma');
  const r = RW.settleRon(g, [
    { winner: 0, score: score(3, 40) },
    { winner: 2, score: score(3, 40) },
  ], 3, rules);
  assert.ok(r.deltas[0] > 0);
  assert.equal(r.deltas[2], 0);
}

// Sanma hanchan: East 3 -> South 1 when dealer rotates.
{
  const g = game('sanma', 'hanchan');
  g.roundWind = 0;
  g.kyoku = 3;
  g.dealerIndex = 2;
  RW.settleRon(g, [{ winner: 0, score: score(1, 30) }], 1, rules);
  assert.equal(g.roundWind, 1);
  assert.equal(g.kyoku, 1);
  assert.equal(g.dealerIndex, 0);
  assert.equal(g.ended, false);
}

// East-only ends after East 4 (or East 3 for sanma) when dealer rotates.
{
  const g = game('yonma', 'east');
  g.kyoku = 4;
  g.dealerIndex = 3;
  RW.settleRon(g, [{ winner: 0, score: score(1, 30) }], 1, rules);
  assert.equal(g.ended, true);
}

console.log('All riichi wind-board logic tests passed.');
