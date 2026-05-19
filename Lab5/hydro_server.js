const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });
console.log('WebSocket сервер для ГЕС запущено на порту 8080');

function generateHydroData() {
    const waterLevel = 50 + Math.sin(Date.now() / 60000) * 2 + (Math.random() - 0.5) * 0.5;
    const flowRate = 20 + Math.sin(Date.now() / 30000) * 5 + Math.random() * 2;
    const efficiency = 75 + Math.sin(Date.now() / 45000) * 8 + (Math.random() - 0.5) * 3;
    const power = 0.98 * 9.81 * flowRate * waterLevel * (efficiency / 100) / 1000;
    const rpm = 120 + power * 12 + (Math.random() - 0.5) * 15;

    return {
        timestamp: Date.now(),
        waterLevel: Math.max(45, Math.min(55, waterLevel)),
        flowRate: Math.max(10, Math.min(30, flowRate)),
        power: Math.max(0, Math.min(25, power)),
        efficiency: Math.max(65, Math.min(92, efficiency)),
        rpm: Math.max(80, Math.min(350, rpm))
    };
}

wss.on('connection', (ws) => {
    console.log('Клієнт підключено');
    const interval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(generateHydroData()));
        }
    }, 2000);

    ws.on('close', () => {
        console.log('Клієнт відключено');
        clearInterval(interval);
    });
});