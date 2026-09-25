namespace RW {
  export type Mode = 'yonma' | 'sanma';
  export type GameLength = 'east' | 'hanchan';
  export type SanmaThirdSeat = 'left' | 'top';
  export type LimitKind = 'normal' | 'mangan' | 'haneman' | 'baiman' | 'sanbaiman' | 'yakuman';

  export interface Rules {
    kiriageMangan: boolean;
    atamahane: boolean;
    kazoeYakuman: boolean;
    multipleYakuman: boolean;
  }

  export interface Config {
    mode: Mode;
    gameLength: GameLength;
    startYonma: number;
    startSanma: number;
    sanmaThirdSeat: SanmaThirdSeat;
    centerTextScale: number;
    playerNames: string[];
    rules: Rules;
  }

  export interface GameState {
    gameId: string;
    mode: Mode;
    gameLength: GameLength;
    scores: number[];
    dealerIndex: number;
    roundWind: 0 | 1;
    kyoku: number;
    honba: number;
    riichiSticks: number;
    riichiDeclared: boolean[];
    ended: boolean;
  }

  export interface AppCore {
    config: Config;
    game: GameState;
  }

  export interface ScoreInput {
    han: number;
    fu: number;
    limit: LimitKind;
    yakumanMultiplier: number;
  }

  export interface ScoreResult {
    base: number;
    label: string;
  }

  export interface RonEntry {
    winner: number;
    score: ScoreInput;
  }

  export interface SettlementResult {
    deltas: number[];
    description: string;
    riichiRecipient: number | null;
  }

  export const DEFAULT_CONFIG: Config = {
    mode: 'yonma',
    gameLength: 'hanchan',
    startYonma: 25000,
    startSanma: 35000,
    sanmaThirdSeat: 'left',
    centerTextScale: 100,
    playerNames: ['玩家 A', '玩家 B', '玩家 C', '玩家 D'],
    rules: {
      kiriageMangan: true,
      atamahane: true,
      kazoeYakuman: true,
      multipleYakuman: true,
    },
  };

  export const WIND_NAMES = ['東', '南', '西', '北'];

  export function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }

  export function playerCount(mode: Mode): number {
    return mode === 'yonma' ? 4 : 3;
  }

  export function startScore(config: Config, mode: Mode): number {
    return mode === 'yonma' ? config.startYonma : config.startSanma;
  }

  export function createGame(config: Config, now = Date.now()): GameState {
    const count = playerCount(config.mode);
    const points = startScore(config, config.mode);
    return {
      gameId: `g-${now}`,
      mode: config.mode,
      gameLength: config.gameLength,
      scores: Array(count).fill(points),
      dealerIndex: 0,
      roundWind: 0,
      kyoku: 1,
      honba: 0,
      riichiSticks: 0,
      riichiDeclared: Array(count).fill(false),
      ended: false,
    };
  }

  export function createInitialCore(config: Config = clone(DEFAULT_CONFIG)): AppCore {
    return { config, game: createGame(config) };
  }

  export function seatWind(game: GameState, playerIndex: number): number {
    const count = playerCount(game.mode);
    return (playerIndex - game.dealerIndex + count) % count;
  }

  export function roundLabel(game: GameState): string {
    if (game.ended) return '終局';
    return `${WIND_NAMES[game.roundWind]}${game.kyoku}局`;
  }

  export function ceil100(n: number): number {
    return Math.ceil(n / 100) * 100;
  }

  export function calculateBase(input: ScoreInput, rules: Rules): ScoreResult {
    const mult = Math.max(1, Math.floor(input.yakumanMultiplier || 1));
    switch (input.limit) {
      case 'mangan': return { base: 2000, label: '滿貫' };
      case 'haneman': return { base: 3000, label: '跳滿' };
      case 'baiman': return { base: 4000, label: '倍滿' };
      case 'sanbaiman': return { base: 6000, label: '三倍滿' };
      case 'yakuman': {
        const used = rules.multipleYakuman ? mult : 1;
        return { base: 8000 * used, label: used > 1 ? `${used}倍役滿` : '役滿' };
      }
    }

    const han = Math.max(1, Math.floor(input.han));
    const fu = Math.max(20, Math.floor(input.fu));
    if (han >= 13) {
      if (rules.kazoeYakuman) return { base: 8000, label: '數え役滿' };
      return { base: 6000, label: '三倍滿' };
    }
    if (han >= 11) return { base: 6000, label: '三倍滿' };
    if (han >= 8) return { base: 4000, label: '倍滿' };
    if (han >= 6) return { base: 3000, label: '跳滿' };
    if (han >= 5) return { base: 2000, label: '滿貫' };
    if (rules.kiriageMangan && ((han === 4 && fu === 30) || (han === 3 && fu === 60))) {
      return { base: 2000, label: '切上滿貫' };
    }
    const raw = fu * Math.pow(2, han + 2);
    if (raw >= 2000) return { base: 2000, label: '滿貫' };
    return { base: raw, label: `${han}番${fu}符` };
  }

  export function ronPoints(base: number, isDealer: boolean): number {
    return ceil100(base * (isDealer ? 6 : 4));
  }

  export function tsumoPayment(base: number, winnerIsDealer: boolean, payerIsDealer: boolean): number {
    if (winnerIsDealer) return ceil100(base * 2);
    return ceil100(base * (payerIsDealer ? 2 : 1));
  }

  export function nearestWinnerFromLoser(game: GameState, loser: number, winners: number[]): number {
    const count = playerCount(game.mode);
    for (let step = 1; step < count; step++) {
      const candidate = (loser + step) % count;
      if (winners.includes(candidate)) return candidate;
    }
    return winners[0];
  }

  export function resetHandFlags(game: GameState): void {
    game.riichiDeclared = Array(playerCount(game.mode)).fill(false);
  }

  export function advanceDealer(game: GameState): void {
    const count = playerCount(game.mode);
    game.dealerIndex = (game.dealerIndex + 1) % count;
    game.kyoku += 1;
    if (game.kyoku > count) {
      game.kyoku = 1;
      if (game.roundWind === 0) {
        if (game.gameLength === 'east') {
          game.ended = true;
          return;
        }
        game.roundWind = 1;
      } else {
        game.ended = true;
        return;
      }
    }
  }

  export function declareRiichi(game: GameState, player: number): void {
    if (game.ended) throw new Error('對局已終局');
    if (game.riichiDeclared[player]) throw new Error('這位玩家本局已經立直');
    if (game.scores[player] < 1000) throw new Error('點數不足 1000，不能立直');
    game.scores[player] -= 1000;
    game.riichiSticks += 1;
    game.riichiDeclared[player] = true;
  }

  export function settleRon(game: GameState, entries: RonEntry[], loser: number, rules: Rules): SettlementResult {
    if (game.ended) throw new Error('對局已終局');
    if (!entries.length) throw new Error('至少要有一位和牌者');
    if (entries.some(e => e.winner === loser)) throw new Error('和牌者不能同時是放銃者');

    let usedEntries = entries.slice();
    if (rules.atamahane && usedEntries.length > 1) {
      const winner = nearestWinnerFromLoser(game, loser, usedEntries.map(e => e.winner));
      usedEntries = [usedEntries.find(e => e.winner === winner)!];
    }

    const deltas = Array(playerCount(game.mode)).fill(0);
    const details: string[] = [];
    for (const entry of usedEntries) {
      const calc = calculateBase(entry.score, rules);
      const pay = ronPoints(calc.base, entry.winner === game.dealerIndex) + game.honba * 300;
      deltas[entry.winner] += pay;
      deltas[loser] -= pay;
      details.push(`${WIND_NAMES[seatWind(game, entry.winner)]}家 ${calc.label} +${pay}`);
    }

    const winners = usedEntries.map(e => e.winner);
    let riichiRecipient: number | null = null;
    if (game.riichiSticks > 0) {
      riichiRecipient = nearestWinnerFromLoser(game, loser, winners);
      const pot = game.riichiSticks * 1000;
      deltas[riichiRecipient] += pot;
      details.push(`供託 ${pot} → ${WIND_NAMES[seatWind(game, riichiRecipient)]}家`);
      game.riichiSticks = 0;
    }

    game.scores = game.scores.map((s, i) => s + deltas[i]);
    const dealerWon = winners.includes(game.dealerIndex);
    if (dealerWon) {
      game.honba += 1;
    } else {
      game.honba = 0;
      advanceDealer(game);
    }
    resetHandFlags(game);

    return {
      deltas,
      description: `榮和｜${details.join('；')}`,
      riichiRecipient,
    };
  }

  export function settleTsumo(game: GameState, winner: number, score: ScoreInput, rules: Rules): SettlementResult {
    if (game.ended) throw new Error('對局已終局');
    const count = playerCount(game.mode);
    const calc = calculateBase(score, rules);
    const deltas = Array(count).fill(0);
    const winnerIsDealer = winner === game.dealerIndex;
    const winnerWind = WIND_NAMES[seatWind(game, winner)];
    const detail: string[] = [];

    for (let payer = 0; payer < count; payer++) {
      if (payer === winner) continue;
      const payment = tsumoPayment(calc.base, winnerIsDealer, payer === game.dealerIndex) + game.honba * 100;
      deltas[payer] -= payment;
      deltas[winner] += payment;
      detail.push(`${WIND_NAMES[seatWind(game, payer)]}家 -${payment}`);
    }

    if (game.riichiSticks > 0) {
      const pot = game.riichiSticks * 1000;
      deltas[winner] += pot;
      game.riichiSticks = 0;
      detail.push(`供託 +${pot}`);
    }

    game.scores = game.scores.map((s, i) => s + deltas[i]);
    if (winnerIsDealer) {
      game.honba += 1;
    } else {
      game.honba = 0;
      advanceDealer(game);
    }
    resetHandFlags(game);

    return {
      deltas,
      description: `自摸｜${winnerWind}家 ${calc.label}；${detail.join('；')}`,
      riichiRecipient: winner,
    };
  }

  export function settleDraw(game: GameState, tenpaiPlayers: number[]): SettlementResult {
    if (game.ended) throw new Error('對局已終局');
    const count = playerCount(game.mode);
    const uniqueTenpai = [...new Set(tenpaiPlayers)].filter(i => i >= 0 && i < count);
    const deltas = Array(count).fill(0);
    const noten = Array.from({ length: count }, (_, i) => i).filter(i => !uniqueTenpai.includes(i));

    if (uniqueTenpai.length > 0 && uniqueTenpai.length < count) {
      const gain = 3000 / uniqueTenpai.length;
      const loss = 3000 / noten.length;
      uniqueTenpai.forEach(i => deltas[i] += gain);
      noten.forEach(i => deltas[i] -= loss);
      game.scores = game.scores.map((s, i) => s + deltas[i]);
    }

    const tenpaiText = uniqueTenpai.length
      ? uniqueTenpai.map(i => `${WIND_NAMES[seatWind(game, i)]}家`).join('、')
      : '無人';
    const dealerTenpai = uniqueTenpai.includes(game.dealerIndex);
    game.honba += 1;
    if (!dealerTenpai) advanceDealer(game);
    resetHandFlags(game);

    return {
      deltas,
      description: `流局｜聽牌：${tenpaiText}`,
      riichiRecipient: null,
    };
  }

  export function scoreDeltaText(deltas: number[]): string {
    return deltas.map((d, i) => `P${i + 1} ${d >= 0 ? '+' : ''}${d}`).join(' / ');
  }
}
