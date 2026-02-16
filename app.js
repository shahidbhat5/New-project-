// Configuration
const SYMBOL = 'BTCUSDT';
const INTERVAL = '1h'; // 1h candles for Supertrend (adjust if needed)
let lastPrice = 0;

// Fetch 1h candles from Binance public API
async function fetchCandles() {
    try {
        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${INTERVAL}&limit=100`);
        if (!response.ok) throw new Error('Network response was not ok');
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
        console.error('Error fetching candles:', error);
        return null;
    }
}

// Calculate Supertrend (period=10, multiplier=3) - Corrected version
function calculateSupertrend(candles) {
    if (!candles || candles.length < 20) return null;
    const period = 10;
    const multiplier = 3;
    
    // Calculate True Range and ATR
    const tr = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
        const trueRange = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        tr.push(trueRange);
    }
    
    // Simple ATR (average of last 'period' TRs)
    const atr = [];
    for (let i = period - 1; i < tr.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += tr[j];
        atr.push(sum / period);
    }
    
    // Supertrend calculation
    let supertrend = [];
    let direction = []; // 1 = up, -1 = down
    for (let i = period; i < candles.length; i++) {
        const idx = i - period; // index in atr array
        const hl2 = (candles[i].high + candles[i].low) / 2;
        const upperBand = hl2 + multiplier * atr[idx];
        const lowerBand = hl2 - multiplier * atr[idx];
        
        if (i === period) {
            // First value: assume uptrend if close > (hl2 + upperBand)/2? Usually we set based on close vs upper
            if (candles[i].close > upperBand) {
                direction[i] = -1; // actually need to define logic properly
                supertrend[i] = lowerBand;
            } else {
                direction[i] = 1;
                supertrend[i] = upperBand;
            }
        } else {
            const prevSuper = supertrend[i-1];
            const prevDir = direction[i-1];
            
            if (prevDir === 1) { // previous uptrend
                if (candles[i].close <= prevSuper) {
                    direction[i] = -1;
                    supertrend[i] = upperBand;
                } else {
                    direction[i] = 1;
                    supertrend[i] = Math.max(prevSuper, lowerBand);
                }
            } else { // previous downtrend
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
    
    // Get last values
    const lastCandle = candles[candles.length-1];
    const lastSuper = supertrend[supertrend.length-1];
    const lastDir = direction[direction.length-1];
    
    if (!lastSuper) return null;
    
    const trend = lastDir === 1 ? 'UP' : 'DOWN';
    return { trend, value: lastSuper, price: lastCandle.close };
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

// Determine buy/sell signal
function getSignal(price, stTrend, rsi) {
    if (!stTrend || rsi === null) return 'WAIT';
    if (stTrend === 'UP' && rsi > 50 && rsi < 70) return 'BUY';
    if (stTrend === 'DOWN' && rsi < 50 && rsi > 30) return 'SELL';
    if (stTrend === 'UP' && rsi <= 50) return 'WATCH';
    if (stTrend === 'DOWN' && rsi >= 50) return 'WATCH';
    return 'NEUTRAL';
}

// Update UI
async function updateDashboard() {
    try {
        const candles = await fetchCandles();
        if (!candles) {
            document.getElementById('price').innerText = 'Error fetching data';
            return;
        }
        
        const currentCandle = candles[candles.length-1];
        const prevCandle = candles[candles.length-2];
        const price = currentCandle.close;
        const priceChange = ((price - prevCandle.close) / prevCandle.close * 100).toFixed(2);
        
        // Update price
        document.getElementById('price').innerText = '$' + price.toFixed(2);
        const changeEl = document.getElementById('change');
        changeEl.innerText = (priceChange > 0 ? '+' : '') + priceChange + '%';
        changeEl.style.color = priceChange >= 0 ? '#0ecb81' : '#f6465d';
        
        // Calculate indicators
        const st = calculateSupertrend(candles);
        const rsi = calculateRSI(candles);
        
        // Update Supertrend display
        if (st) {
            document.getElementById('supertrend').innerHTML = `${st.trend} <span style="font-size:0.9rem; color:#8d9bb5;">$${st.value.toFixed(2)}</span>`;
        } else {
            document.getElementById('supertrend').innerText = '--';
        }
        
        // Update RSI
        if (rsi !== null) {
            document.getElementById('rsi').innerText = rsi.toFixed(2);
        } else {
            document.getElementById('rsi').innerText = '--';
        }
        
        // Update signal
        const signal = getSignal(price, st?.trend, rsi);
        const signalEl = document.getElementById('signal');
        signalEl.innerText = signal;
        signalEl.className = 'signal-value ' + 
            (signal === 'BUY' ? 'buy' : (signal === 'SELL' ? 'sell' : 'neutral'));
        
        // Update timestamp
        const now = new Date();
        document.getElementById('timestamp').innerText = 'Last update: ' + now.toLocaleTimeString();
    } catch (e) {
        console.error('Update failed:', e);
        document.getElementById('price').innerText = 'Error';
    }
}

// Auto-refresh every 60 seconds
let interval = setInterval(updateDashboard, 60000);
updateDashboard();

// Manual refresh button
document.getElementById('refreshBtn').addEventListener('click', () => {
    updateDashboard();
});

// Stop interval when page unloads (optional)
window.addEventListener('beforeunload', () => clearInterval(interval));
