// Configuration
const SYMBOL = 'BTCUSDT';
const INTERVAL = '1h'; // Timeframe for analysis
let lastPrice = 0;

// Fetch candles from Binance
async function fetchCandles() {
    try {
        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${INTERVAL}&limit=100`);
        if (!response.ok) throw new Error('Network error');
        const data = await response.json();
        return data.map(candle => ({
            time: candle[0],
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5])
        }));
    } catch (error) {
        console.error('Fetch error:', error);
        return null;
    }
}

// Calculate ATR (used for Supertrend and stop levels)
function calculateATR(candles, period = 14) {
    if (!candles || candles.length < period + 1) return null;
    const tr = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
        const trueRange = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        tr.push(trueRange);
    }
    // Simple moving average of TR
    let atr = [];
    for (let i = period - 1; i < tr.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += tr[j];
        atr.push(sum / period);
    }
    return atr;
}

// Calculate Supertrend (period=10, multiplier=3)
function calculateSupertrend(candles) {
    if (!candles || candles.length < 20) return null;
    const period = 10;
    const multiplier = 3;
    const atr = calculateATR(candles, period);
    if (!atr) return null;

    let supertrend = [];
    let direction = [];
    for (let i = period; i < candles.length; i++) {
        const idx = i - period;
        const hl2 = (candles[i].high + candles[i].low) / 2;
        const upperBand = hl2 + multiplier * atr[idx];
        const lowerBand = hl2 - multiplier * atr[idx];

        if (i === period) {
            // Initial value
            if (candles[i].close > upperBand) {
                direction[i] = 1;
                supertrend[i] = lowerBand;
            } else {
                direction[i] = -1;
                supertrend[i] = upperBand;
            }
        } else {
            const prevSuper = supertrend[i-1];
            const prevDir = direction[i-1];

            if (prevDir === 1) {
                if (candles[i].close <= prevSuper) {
                    direction[i] = -1;
                    supertrend[i] = upperBand;
                } else {
                    direction[i] = 1;
                    supertrend[i] = Math.max(prevSuper, lowerBand);
                }
            } else {
                if (candles[i].close >= prevSuper) {
                    direction[i] = 1;
                    supertrend[i] = lowerBand;
                } else {
                    direction[i] = -1;
                    supertrend[i] = Math.min(prevSuper, upperBand);
                }
            }
        }
    }

    const lastCandle = candles[candles.length-1];
    const lastSuper = supertrend[supertrend.length-1];
    const lastDir = direction[direction.length-1];
    if (!lastSuper) return null;

    return {
        trend: lastDir === 1 ? 'UP' : 'DOWN',
        value: lastSuper,
        price: lastCandle.close
    };
}

// Calculate RSI (14)
function calculateRSI(candles, period = 14) {
    if (!candles || candles.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        const change = candles[i].close - candles[i-1].close;
        if (change >= 0) gains += change;
        else losses -= change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// Get latest ATR value for risk management
function getLatestATR(candles, period = 14) {
    const atrArray = calculateATR(candles, period);
    return atrArray ? atrArray[atrArray.length-1] : null;
}

// Determine signal and compute trade levels
function analyzeMarket(candles) {
    if (!candles) return null;

    const price = candles[candles.length-1].close;
    const st = calculateSupertrend(candles);
    const rsi = calculateRSI(candles);
    const atr = getLatestATR(candles, 14); // use 14-period ATR for stop distances

    // Signal logic (same as before)
    let signal = 'WAIT';
    if (st && rsi !== null) {
        if (st.trend === 'UP' && rsi > 50 && rsi < 70) signal = 'BUY';
        else if (st.trend === 'DOWN' && rsi < 50 && rsi > 30) signal = 'SELL';
        else if (st.trend === 'UP' && rsi <= 50) signal = 'WATCH';
        else if (st.trend === 'DOWN' && rsi >= 50) signal = 'WATCH';
        else signal = 'NEUTRAL';
    }

    // Compute trade levels if we have ATR and a clear direction
    let stopLoss = null;
    let tp1 = null;
    let tp2 = null;

    if (atr) {
        const slDistance = atr * 1.5; // Stop loss distance
        const tp1Distance = atr * 3;   // Take profit 1 (2:1 risk-reward)
        const tp2Distance = atr * 5;   // Take profit 2 (approx 3.3:1)

        if (signal === 'BUY') {
            stopLoss = price - slDistance;
            tp1 = price + tp1Distance;
            tp2 = price + tp2Distance;
        } else if (signal === 'SELL') {
            stopLoss = price + slDistance;
            tp1 = price - tp1Distance;
            tp2 = price - tp2Distance;
        }
    }

    return {
        price,
        priceChange: ((price - candles[candles.length-2].close) / candles[candles.length-2].close * 100).toFixed(2),
        st,
        rsi,
        signal,
        atr,
        stopLoss,
        tp1,
        tp2
    };
}

// Update UI
async function updateDashboard() {
    const candles = await fetchCandles();
    if (!candles) {
        document.getElementById('price').innerText = 'Error';
        return;
    }

    const analysis = analyzeMarket(candles);
    if (!analysis) return;

    // Update price
    document.getElementById('price').innerText = '$' + analysis.price.toFixed(2);
    const changeEl = document.getElementById('change');
    changeEl.innerText = (analysis.priceChange > 0 ? '+' : '') + analysis.priceChange + '%';
    changeEl.style.color = analysis.priceChange >= 0 ? '#0ecb81' : '#f6465d';

    // Update Supertrend
    if (analysis.st) {
        document.getElementById('supertrend').innerHTML = `${analysis.st.trend} <span style="font-size:0.9rem; color:#8d9bb5;">$${analysis.st.value.toFixed(2)}</span>`;
    } else {
        document.getElementById('supertrend').innerText = '--';
    }

    // Update RSI
    document.getElementById('rsi').innerText = analysis.rsi ? analysis.rsi.toFixed(2) : '--';

    // Update signal
    const signalEl = document.getElementById('signal');
    signalEl.innerText = analysis.signal;
    signalEl.className = 'signal-value ' + 
        (analysis.signal === 'BUY' ? 'buy' : (analysis.signal === 'SELL' ? 'sell' : 'neutral'));

    // Update trade levels
    document.getElementById('entry').innerText = '$' + analysis.price.toFixed(2);
    if (analysis.stopLoss) {
        document.getElementById('stopLoss').innerText = '$' + analysis.stopLoss.toFixed(2);
        document.getElementById('tp1').innerText = '$' + analysis.tp1.toFixed(2);
        document.getElementById('tp2').innerText = '$' + analysis.tp2.toFixed(2);
    } else {
        document.getElementById('stopLoss').innerText = '---';
        document.getElementById('tp1').innerText = '---';
        document.getElementById('tp2').innerText = '---';
    }

    // Timestamp
    document.getElementById('timestamp').innerText = 'Last update: ' + new Date().toLocaleTimeString();
}

// Auto-refresh every 60 seconds
let interval = setInterval(updateDashboard, 60000);
updateDashboard();

document.getElementById('refreshBtn').addEventListener('click', updateDashboard);
window.addEventListener('beforeunload', () => clearInterval(interval));
