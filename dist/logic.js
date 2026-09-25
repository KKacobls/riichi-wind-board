"use strict";
var RW;
(function (RW) {
    RW.DEFAULT_CONFIG = {
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
    RW.WIND_NAMES = ['東', '南', '西', '北'];
    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }
    RW.clone = clone;
    function playerCount(mode) {
        return mode === 'yonma' ? 4 : 3;
    }
    RW.playerCount = playerCount;
    function startScore(config, mode) {
        return mode === 'yonma' ? config.startYonma : config.startSanma;
    }
    RW.startScore = startScore;
    function createGame(config, now = Date.now()) {
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
    RW.createGame = createGame;
    function createInitialCore(config = clone(RW.DEFAULT_CONFIG)) {
        return { config, game: createGame(config) };
    }
    RW.createInitialCore = createInitialCore;
    function seatWind(game, playerIndex) {
        const count = playerCount(game.mode);
        return (playerIndex - game.dealerIndex + count) % count;
    }
    RW.seatWind = seatWind;
    function roundLabel(game) {
        if (game.ended)
            return '終局';
        return `${RW.WIND_NAMES[game.roundWind]}${game.kyoku}局`;
    }
    RW.roundLabel = roundLabel;
    function ceil100(n) {
        return Math.ceil(n / 100) * 100;
    }
    RW.ceil100 = ceil100;
    function calculateBase(input, rules) {
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
            if (rules.kazoeYakuman)
                return { base: 8000, label: '數え役滿' };
            return { base: 6000, label: '三倍滿' };
        }
        if (han >= 11)
            return { base: 6000, label: '三倍滿' };
        if (han >= 8)
            return { base: 4000, label: '倍滿' };
        if (han >= 6)
            return { base: 3000, label: '跳滿' };
        if (han >= 5)
            return { base: 2000, label: '滿貫' };
        if (rules.kiriageMangan && ((han === 4 && fu === 30) || (han === 3 && fu === 60))) {
            return { base: 2000, label: '切上滿貫' };
        }
        const raw = fu * Math.pow(2, han + 2);
        if (raw >= 2000)
            return { base: 2000, label: '滿貫' };
        return { base: raw, label: `${han}番${fu}符` };
    }
    RW.calculateBase = calculateBase;
    function ronPoints(base, isDealer) {
        return ceil100(base * (isDealer ? 6 : 4));
    }
    RW.ronPoints = ronPoints;
    function tsumoPayment(base, winnerIsDealer, payerIsDealer) {
        if (winnerIsDealer)
            return ceil100(base * 2);
        return ceil100(base * (payerIsDealer ? 2 : 1));
    }
    RW.tsumoPayment = tsumoPayment;
    function nearestWinnerFromLoser(game, loser, winners) {
        const count = playerCount(game.mode);
        for (let step = 1; step < count; step++) {
            const candidate = (loser + step) % count;
            if (winners.includes(candidate))
                return candidate;
        }
        return winners[0];
    }
    RW.nearestWinnerFromLoser = nearestWinnerFromLoser;
    function resetHandFlags(game) {
        game.riichiDeclared = Array(playerCount(game.mode)).fill(false);
    }
    RW.resetHandFlags = resetHandFlags;
    function advanceDealer(game) {
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
            }
            else {
                game.ended = true;
                return;
            }
        }
    }
    RW.advanceDealer = advanceDealer;
    function declareRiichi(game, player) {
        if (game.ended)
            throw new Error('對局已終局');
        if (game.riichiDeclared[player])
            throw new Error('這位玩家本局已經立直');
        if (game.scores[player] < 1000)
            throw new Error('點數不足 1000，不能立直');
        game.scores[player] -= 1000;
        game.riichiSticks += 1;
        game.riichiDeclared[player] = true;
    }
    RW.declareRiichi = declareRiichi;
    function settleRon(game, entries, loser, rules) {
        if (game.ended)
            throw new Error('對局已終局');
        if (!entries.length)
            throw new Error('至少要有一位和牌者');
        if (entries.some(e => e.winner === loser))
            throw new Error('和牌者不能同時是放銃者');
        let usedEntries = entries.slice();
        if (rules.atamahane && usedEntries.length > 1) {
            const winner = nearestWinnerFromLoser(game, loser, usedEntries.map(e => e.winner));
            usedEntries = [usedEntries.find(e => e.winner === winner)];
        }
        const deltas = Array(playerCount(game.mode)).fill(0);
        const details = [];
        for (const entry of usedEntries) {
            const calc = calculateBase(entry.score, rules);
            const pay = ronPoints(calc.base, entry.winner === game.dealerIndex) + game.honba * 300;
            deltas[entry.winner] += pay;
            deltas[loser] -= pay;
            details.push(`${RW.WIND_NAMES[seatWind(game, entry.winner)]}家 ${calc.label} +${pay}`);
        }
        const winners = usedEntries.map(e => e.winner);
        let riichiRecipient = null;
        if (game.riichiSticks > 0) {
            riichiRecipient = nearestWinnerFromLoser(game, loser, winners);
            const pot = game.riichiSticks * 1000;
            deltas[riichiRecipient] += pot;
            details.push(`供託 ${pot} → ${RW.WIND_NAMES[seatWind(game, riichiRecipient)]}家`);
            game.riichiSticks = 0;
        }
        game.scores = game.scores.map((s, i) => s + deltas[i]);
        const dealerWon = winners.includes(game.dealerIndex);
        if (dealerWon) {
            game.honba += 1;
        }
        else {
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
    RW.settleRon = settleRon;
    function settleTsumo(game, winner, score, rules) {
        if (game.ended)
            throw new Error('對局已終局');
        const count = playerCount(game.mode);
        const calc = calculateBase(score, rules);
        const deltas = Array(count).fill(0);
        const winnerIsDealer = winner === game.dealerIndex;
        const winnerWind = RW.WIND_NAMES[seatWind(game, winner)];
        const detail = [];
        for (let payer = 0; payer < count; payer++) {
            if (payer === winner)
                continue;
            const payment = tsumoPayment(calc.base, winnerIsDealer, payer === game.dealerIndex) + game.honba * 100;
            deltas[payer] -= payment;
            deltas[winner] += payment;
            detail.push(`${RW.WIND_NAMES[seatWind(game, payer)]}家 -${payment}`);
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
        }
        else {
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
    RW.settleTsumo = settleTsumo;
    function settleDraw(game, tenpaiPlayers) {
        if (game.ended)
            throw new Error('對局已終局');
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
            ? uniqueTenpai.map(i => `${RW.WIND_NAMES[seatWind(game, i)]}家`).join('、')
            : '無人';
        const dealerTenpai = uniqueTenpai.includes(game.dealerIndex);
        game.honba += 1;
        if (!dealerTenpai)
            advanceDealer(game);
        resetHandFlags(game);
        return {
            deltas,
            description: `流局｜聽牌：${tenpaiText}`,
            riichiRecipient: null,
        };
    }
    RW.settleDraw = settleDraw;
    function settleAbortiveDraw(game) {
        if (game.ended)
            throw new Error('對局已終局');
        game.honba += 1;
        resetHandFlags(game);
        return {
            deltas: Array(playerCount(game.mode)).fill(0),
            description: `中途流局｜連莊・${game.honba}本場｜供託保留 ${game.riichiSticks}`,
            riichiRecipient: null,
        };
    }
    RW.settleAbortiveDraw = settleAbortiveDraw;
    function settleNagashiMangan(game, winners, dealerTenpai) {
        if (game.ended)
            throw new Error('對局已終局');
        const count = playerCount(game.mode);
        const uniqueWinners = [...new Set(winners)].filter(i => i >= 0 && i < count);
        if (!uniqueWinners.length)
            throw new Error('至少要選一位流局滿貫者');
        const deltas = Array(count).fill(0);
        const base = 2000;
        const details = [];
        for (const winner of uniqueWinners) {
            const winnerIsDealer = winner === game.dealerIndex;
            let received = 0;
            for (let payer = 0; payer < count; payer++) {
                if (payer === winner)
                    continue;
                const payment = tsumoPayment(base, winnerIsDealer, payer === game.dealerIndex);
                deltas[payer] -= payment;
                deltas[winner] += payment;
                received += payment;
            }
            details.push(`${RW.WIND_NAMES[seatWind(game, winner)]}家 +${received}`);
        }
        game.scores = game.scores.map((s, i) => s + deltas[i]);
        game.honba += 1;
        if (!dealerTenpai)
            advanceDealer(game);
        resetHandFlags(game);
        return {
            deltas,
            description: `流局滿貫｜${details.join('；')}｜不計聽牌罰符｜供託保留 ${game.riichiSticks}`,
            riichiRecipient: null,
        };
    }
    RW.settleNagashiMangan = settleNagashiMangan;
    function overrideDealer(game, player) {
        const count = playerCount(game.mode);
        if (!Number.isInteger(player) || player < 0 || player >= count)
            throw new Error('無效的莊家');
        game.dealerIndex = player;
    }
    RW.overrideDealer = overrideDealer;
    function scoreDeltaText(deltas) {
        return deltas.map((d, i) => `P${i + 1} ${d >= 0 ? '+' : ''}${d}`).join(' / ');
    }
    RW.scoreDeltaText = scoreDeltaText;
})(RW || (RW = {}));
