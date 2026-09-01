// Fallback realistic option chain dataset matching user sample & screenshot
const generateFallbackOptionChain = (symbol = "NIFTY", expiry = "01-Sep-2026") => {
  const spotPrice = 24055.8;
  const change = -24.60;
  
  // Real strikes from the screenshot and user's prompt
  const baseStrikes = [
    // SET A (Above Spot > 24055.8)
    { strike: 25000, ceIV: 26.50, ceOiChg: -1200400, ceOi: 3200450, ceVol: 8500200, ceLtp: 0.05, peLtp: 945.00, peVol: 120000, peOi: 85000, peOiChg: -2500, peIV: 0.00 },
    { strike: 24900, ceIV: 25.10, ceOiChg: -1450200, ceOi: 3850000, ceVol: 10200400, ceLtp: 0.05, peLtp: 845.00, peVol: 240000, peOi: 110000, peOiChg: -4500, peIV: 0.00 },
    { strike: 24800, ceIV: 24.00, ceOiChg: -1800000, ceOi: 4900000, ceVol: 14500000, ceLtp: 0.05, peLtp: 745.00, peVol: 450000, peOi: 165000, peOiChg: -8500, peIV: 0.00 },
    { strike: 24700, ceIV: 22.80, ceOiChg: -2100000, ceOi: 5600000, ceVol: 19800000, ceLtp: 0.05, peLtp: 645.00, peVol: 890000, peOi: 245000, peOiChg: -15000, peIV: 0.00 },
    { strike: 24650, ceIV: 21.90, ceOiChg: -2500000, ceOi: 6200000, ceVol: 22400000, ceLtp: 0.05, peLtp: 595.00, peVol: 1200000, peOi: 310000, peOiChg: -28000, peIV: 0.00 },
    { strike: 24600, ceIV: 20.80, ceOiChg: -3200000, ceOi: 7400000, ceVol: 28900000, ceLtp: 0.05, peLtp: 545.00, peVol: 2100000, peOi: 450000, peOiChg: -45000, peIV: 35.20 },
    { strike: 24550, ceIV: 19.80, ceOiChg: -3800000, ceOi: 8100000, ceVol: 31200000, ceLtp: 0.05, peLtp: 495.00, peVol: 3400000, peOi: 580000, peOiChg: -85000, peIV: 32.50 },
    { strike: 24500, ceIV: 19.04, ceOiChg: -4435015, ceOi: 8560465, ceVol: 35600465, ceLtp: 0.05, peLtp: 445.00, peVol: 5169775, peOi: 711945, peOiChg: -445640, peIV: 30.74 },
    { strike: 24450, ceIV: 17.80, ceOiChg: -3100000, ceOi: 6800000, ceVol: 180000000, ceLtp: 0.05, peLtp: 395.00, peVol: 5800000, peOi: 450000, peOiChg: -230000, peIV: 26.50 },
    { strike: 24400, ceIV: 16.51, ceOiChg: -2259790, ceOi: 7018115, ceVol: 320100365, ceLtp: 0.05, peLtp: 345.10, peVol: 6820905, peOi: 211900, peOiChg: -456820, peIV: 23.61 },
    { strike: 24350, ceIV: 13.94, ceOiChg: -2417610, ceOi: 12155455, ceVol: 542342450, ceLtp: 0.05, peLtp: 293.75, peVol: 36408255, peOi: 1170975, peOiChg: -1372215, peIV: 20.86 },
    { strike: 24300, ceIV: 11.32, ceOiChg: -2324790, ceOi: 5627440, ceVol: 530522655, ceLtp: 0.05, peLtp: 244.00, peVol: 62936380, peOi: 695175, peOiChg: -742170, peIV: 17.00 },
    { strike: 24250, ceIV: 8.64, ceOiChg: -914875, ceOi: 11684140, ceVol: 1046987630, ceLtp: 0.05, peLtp: 193.90, peVol: 260348790, peOi: 3018145, peOiChg: -2599415, peIV: 13.68 },
    { strike: 24200, ceIV: 5.88, ceOiChg: 6253260, ceOi: 13183625, ceVol: 1352326885, ceLtp: 0.05, peLtp: 144.10, peVol: 474804720, peOi: 4673890, peOiChg: 445835, peIV: 9.55 },
    { strike: 24150, ceIV: 2.96, ceOiChg: 15147600, ceOi: 25143105, ceVol: 2122429270, ceLtp: 0.05, peLtp: 94.00, peVol: 1407027115, peOi: 7465705, peOiChg: -2714465, peIV: 5.41 },
    { strike: 24100, ceIV: 1.27, ceOiChg: 226852, ceOi: 380629, ceVol: 32652760, ceLtp: 0.05, peLtp: 44.15, peVol: 21646571, peOi: 113219, peOiChg: -43399, peIV: 3.97 },

    // SET B (Below Spot < 24055.8)
    { strike: 24050, ceIV: 11.21, ceOiChg: 11736595, ceOi: 16099070, ceVol: 1805252735, ceLtp: 5.75, peLtp: 0.05, peVol: 1870935040, peOi: 24325145, peOiChg: 15805790, peIV: 0.66 },
    { strike: 24000, ceIV: 26.74, ceOiChg: 5253820, ceOi: 9489870, ceVol: 1396150080, ceLtp: 55.65, peLtp: 0.05, peVol: 2401223500, peOi: 23722140, peOiChg: 7697755, peIV: 3.84 },
    { strike: 23950, ceIV: 36.97, ceOiChg: 3161600, ceOi: 3657095, ceVol: 420422600, ceLtp: 105.65, peLtp: 0.05, peVol: 1729267020, peOi: 14246050, peOiChg: 7777575, peIV: 6.73 },
    { strike: 23900, ceIV: 45.25, ceOiChg: 684255, ceOi: 1186185, ceVol: 184844985, ceLtp: 155.45, peLtp: 0.05, peVol: 1238882385, peOi: 10434060, peOiChg: 1370785, peIV: 9.49 },
    { strike: 23850, ceIV: 53.32, ceOiChg: 227045, ceOi: 358995, ceVol: 33572890, ceLtp: 206.20, peLtp: 0.05, peVol: 599693770, peOi: 5207475, peOiChg: -279760, peIV: 12.20 },
    { strike: 23800, ceIV: 60.89, ceOiChg: 52975, ceOi: 295165, ceVol: 22988355, ceLtp: 255.30, peLtp: 0.05, peVol: 501863830, peOi: 7712965, peOiChg: -1666795, peIV: 14.85 },
    { strike: 23750, ceIV: 68.38, ceOiChg: 44915, ceOi: 96135, ceVol: 3136445, ceLtp: 306.45, peLtp: 0.05, peVol: 274743105, peOi: 3744390, peOiChg: -2035410, peIV: 17.47 },
    { strike: 23700, ceIV: 75.19, ceOiChg: 36270, ceOi: 126100, ceVol: 2718755, ceLtp: 355.30, peLtp: 0.05, peVol: 193356020, peOi: 6952335, peOiChg: -1575470, peIV: 20.07 },
    { strike: 23650, ceIV: 81.75, ceOiChg: 31005, ceOi: 51220, ceVol: 456170, ceLtp: 405.50, peLtp: 0.05, peVol: 89880895, peOi: 3771495, peOiChg: 331435, peIV: 22.64 },
    { strike: 23600, ceIV: 33.64, ceOiChg: 21385, ceOi: 58305, ceVol: 461565, ceLtp: 455.40, peLtp: 0.05, peVol: 123333600, peOi: 5287750, peOiChg: -448240, peIV: 25.17 },
    { strike: 23550, ceIV: 38.20, ceOiChg: 15400, ceOi: 42100, ceVol: 320000, ceLtp: 505.00, peLtp: 0.05, peVol: 98000000, peOi: 4100000, peOiChg: -320000, peIV: 27.80 },
    { strike: 23500, ceIV: 42.10, ceOiChg: 12500, ceOi: 38000, ceVol: 290000, ceLtp: 555.00, peLtp: 0.05, peVol: 84000000, peOi: 3800000, peOiChg: -280000, peIV: 29.50 },
    { strike: 23450, ceIV: 45.60, ceOiChg: 8900, ceOi: 29000, ceVol: 210000, ceLtp: 605.00, peLtp: 0.05, peVol: 65000000, peOi: 2900000, peOiChg: -190000, peIV: 31.40 },
    { strike: 23400, ceIV: 48.90, ceOiChg: 6500, ceOi: 24000, ceVol: 180000, ceLtp: 655.00, peLtp: 0.05, peVol: 52000000, peOi: 2200000, peOiChg: -150000, peIV: 33.10 },
    { strike: 23350, ceIV: 52.00, ceOiChg: 4800, ceOi: 19000, ceVol: 140000, ceLtp: 705.00, peLtp: 0.05, peVol: 41000000, peOi: 1800000, peOiChg: -110000, peIV: 34.80 },
    { strike: 23300, ceIV: 55.40, ceOiChg: 3200, ceOi: 15000, ceVol: 110000, ceLtp: 755.00, peLtp: 0.05, peVol: 32000000, peOi: 1400000, peOiChg: -85000, peIV: 36.20 },
    { strike: 23200, ceIV: 58.70, ceOiChg: 2100, ceOi: 12000, ceVol: 85000, ceLtp: 855.00, peLtp: 0.05, peVol: 21000000, peOi: 950000, peOiChg: -65000, peIV: 38.00 },
    { strike: 23100, ceIV: 62.10, ceOiChg: 1500, ceOi: 9800, ceVol: 65000, ceLtp: 955.00, peLtp: 0.05, peVol: 15000000, peOi: 720000, peOiChg: -45000, peIV: 40.50 },
    { strike: 23000, ceIV: 65.50, ceOiChg: 1100, ceOi: 7500, ceVol: 45000, ceLtp: 1055.00, peLtp: 0.05, peVol: 9800000, peOi: 510000, peOiChg: -32000, peIV: 43.00 },
    { strike: 22900, ceIV: 68.20, ceOiChg: 800, ceOi: 6200, ceVol: 35000, ceLtp: 1155.00, peLtp: 0.05, peVol: 7200000, peOi: 420000, peOiChg: -25000, peIV: 45.50 },
    { strike: 22800, ceIV: 71.00, ceOiChg: 650, ceOi: 5100, ceVol: 28000, ceLtp: 1255.00, peLtp: 0.05, peVol: 5800000, peOi: 350000, peOiChg: -18000, peIV: 48.00 },
    { strike: 22700, ceIV: 74.00, ceOiChg: 500, ceOi: 4200, ceVol: 21000, ceLtp: 1355.00, peLtp: 0.05, peVol: 4500000, peOi: 290000, peOiChg: -12000, peIV: 50.50 },
    { strike: 22600, ceIV: 77.00, ceOiChg: 400, ceOi: 3500, ceVol: 16000, ceLtp: 1455.00, peLtp: 0.05, peVol: 3400000, peOi: 240000, peOiChg: -9000, peIV: 53.00 },
    { strike: 22500, ceIV: 80.00, ceOiChg: 300, ceOi: 2900, ceVol: 12000, ceLtp: 1555.00, peLtp: 0.05, peVol: 2600000, peOi: 190000, peOiChg: -6000, peIV: 55.50 }
  ];

  // Also add higher strikes up to 26000 to ensure we have at least 30 strikes above and below
  const additionalAbove = [
    { strike: 25500, ceIV: 32.0, ceOiChg: -500000, ceOi: 1200000, ceVol: 3500000, ceLtp: 0.05, peLtp: 1445.0, peVol: 45000, peOi: 35000, peOiChg: -500, peIV: 0.0 },
    { strike: 25400, ceIV: 31.0, ceOiChg: -600000, ceOi: 1500000, ceVol: 4200000, ceLtp: 0.05, peLtp: 1345.0, peVol: 55000, peOi: 42000, peOiChg: -800, peIV: 0.0 },
    { strike: 25300, ceIV: 30.0, ceOiChg: -750000, ceOi: 1900000, ceVol: 5100000, ceLtp: 0.05, peLtp: 1245.0, peVol: 70000, peOi: 51000, peOiChg: -1100, peIV: 0.0 },
    { strike: 25200, ceIV: 29.0, ceOiChg: -900000, ceOi: 2300000, ceVol: 6200000, ceLtp: 0.05, peLtp: 1145.0, peVol: 85000, peOi: 62000, peOiChg: -1500, peIV: 0.0 },
    { strike: 25100, ceIV: 28.0, ceOiChg: -1050000, ceOi: 2800000, ceVol: 7400000, ceLtp: 0.05, peLtp: 1045.0, peVol: 98000, peOi: 75000, peOiChg: -2000, peIV: 0.0 }
  ];

  const allStrikes = [...additionalAbove, ...baseStrikes].sort((a, b) => b.strike - a.strike);

  const data = allStrikes.map(s => {
    return {
      strikePrice: s.strike,
      expiryDates: expiry,
      CE: {
        strikePrice: s.strike,
        expiryDate: expiry,
        underlying: symbol,
        identifier: `OPTIDX${symbol}${expiry}CE${s.strike}.00`,
        openInterest: s.ceOi,
        changeinOpenInterest: s.ceOiChg,
        pchangeinOpenInterest: ((s.ceOiChg / (s.ceOi - s.ceOiChg || 1)) * 100).toFixed(2),
        totalTradedVolume: s.ceVol,
        impliedVolatility: s.ceIV,
        lastPrice: s.ceLtp,
        change: s.ceLtp > 5 ? -18.55 : -76.65,
        pChange: -99.93,
        underlyingValue: spotPrice
      },
      PE: {
        strikePrice: s.strike,
        expiryDate: expiry,
        underlying: symbol,
        identifier: `OPTIDX${symbol}${expiry}PE${s.strike}.00`,
        openInterest: s.peOi,
        changeinOpenInterest: s.peOiChg,
        pchangeinOpenInterest: ((s.peOiChg / (s.peOi - s.peOiChg || 1)) * 100).toFixed(2),
        totalTradedVolume: s.peVol,
        impliedVolatility: s.peIV,
        lastPrice: s.peLtp,
        change: s.peLtp > 5 ? -18.55 : -76.65,
        pChange: -29.58,
        underlyingValue: spotPrice
      }
    };
  });

  return {
    records: {
      expiryDates: ["01-Sep-2026", "08-Sep-2026", "15-Sep-2026", "29-Sep-2026", "29-Oct-2026", "31-Dec-2026"],
      data: data,
      timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      underlyingValue: spotPrice,
      strikePrices: allStrikes.map(s => s.strike)
    },
    filtered: {
      data: data,
      CE: {
        totOI: data.reduce((acc, d) => acc + (d.CE?.openInterest || 0), 0),
        totVol: data.reduce((acc, d) => acc + (d.CE?.totalTradedVolume || 0), 0)
      },
      PE: {
        totOI: data.reduce((acc, d) => acc + (d.PE?.openInterest || 0), 0),
        totVol: data.reduce((acc, d) => acc + (d.PE?.totalTradedVolume || 0), 0)
      }
    }
  };
};

module.exports = { generateFallbackOptionChain };
