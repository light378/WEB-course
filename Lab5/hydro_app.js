class HydroMonitor {
    constructor() {
        this.waterChart = null;
        this.powerChart = null;
        this.efficiencyChart = null;
        this.history = [];
        this.initCharts();
        this.connectWebSocket();
    }

    initCharts() {
        const ctxWater = document.getElementById('waterLevelChart').getContext('2d');
        this.waterChart = new Chart(ctxWater, {
            type: 'line',
            data: { labels: [], datasets: [{ label: 'Рівень води (м)', data: [], borderColor: '#1e88e5', tension: 0.3 }] },
            options: { responsive: true, scales: { y: { beginAtZero: true, title: { display: true, text: 'м' } } } }
        });

        const ctxPower = document.getElementById('powerChart').getContext('2d');
        this.powerChart = new Chart(ctxPower, {
            type: 'line',
            data: { labels: [], datasets: [{ label: 'Потужність (МВт)', data: [], borderColor: '#f9a825', tension: 0.3 }] },
            options: { responsive: true, scales: { y: { beginAtZero: true, title: { display: true, text: 'МВт' } } } }
        });

        const ctxEff = document.getElementById('efficiencyChart').getContext('2d');
        this.efficiencyChart = new Chart(ctxEff, {
            type: 'doughnut',
            data: { labels: ['Ефективність', 'Втрати'], datasets: [{ data: [85, 15], backgroundColor: ['#43a047', '#e53935'] }] },
            options: { responsive: true, cutout: '60%' }
        });
    }

    connectWebSocket() {
        this.socket = new WebSocket('ws://localhost:8080');
        this.socket.onopen = () => {
            document.getElementById('status').textContent = 'Онлайн';
            document.getElementById('status').className = 'status-online';
        };
        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.updateUI(data);
        };
        this.socket.onerror = () => {
            document.getElementById('status').textContent = 'Помилка';
            document.getElementById('status').className = 'status-offline';
        };
        this.socket.onclose = () => {
            document.getElementById('status').textContent = 'Офлайн';
            document.getElementById('status').className = 'status-offline';
            setTimeout(() => this.connectWebSocket(), 5000);
        };
    }

    updateUI(data) {
        document.getElementById('waterLevel').innerText = `${data.waterLevel.toFixed(2)} м`;
        document.getElementById('flowRate').innerText = `${data.flowRate.toFixed(2)} м³/с`;
        document.getElementById('power').innerText = `${data.power.toFixed(2)} МВт`;
        document.getElementById('efficiency').innerText = `${data.efficiency.toFixed(1)} %`;
        document.getElementById('rpm').innerText = `${Math.round(data.rpm)} об/хв`;
        const rpmPercent = Math.min(100, (data.rpm / 300) * 100);
        document.getElementById('rpmBar').style.width = `${rpmPercent}%`;

        this.efficiencyChart.data.datasets[0].data = [data.efficiency, 100 - data.efficiency];
        this.efficiencyChart.update();

        const time = new Date(data.timestamp).toLocaleTimeString();
        this.waterChart.data.labels.push(time);
        this.waterChart.data.datasets[0].data.push(data.waterLevel);
        if (this.waterChart.data.labels.length > 20) {
            this.waterChart.data.labels.shift();
            this.waterChart.data.datasets[0].data.shift();
        }
        this.waterChart.update();

        this.powerChart.data.labels.push(time);
        this.powerChart.data.datasets[0].data.push(data.power);
        if (this.powerChart.data.labels.length > 20) {
            this.powerChart.data.labels.shift();
            this.powerChart.data.datasets[0].data.shift();
        }
        this.powerChart.update();

        this.history.unshift(data);
        if (this.history.length > 10) this.history.pop();
        this.renderTable();
    }

    renderTable() {
        const container = document.getElementById('historyTable');
        if (!container) return;
        const table = document.createElement('table');
        table.className = 'table table-sm table-striped';
        table.innerHTML = `
            <thead><tr>
                <th>Час</th><th>Рівень води (м)</th><th>Витрата (м³/с)</th>
                <th>Потужність (МВт)</th><th>Оберти (об/хв)</th><th>Ефективність (%)</th>
            </tr></thead>
            <tbody>
                ${this.history.map(item => `
                    <tr>
                        <td>${new Date(item.timestamp).toLocaleTimeString()}</td>
                        <td>${item.waterLevel.toFixed(2)}</td>
                        <td>${item.flowRate.toFixed(2)}</td>
                        <td>${item.power.toFixed(2)}</td>
                        <td>${Math.round(item.rpm)}</td>
                        <td>${item.efficiency.toFixed(1)}</td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        container.innerHTML = '';
        container.appendChild(table);
    }
}

document.addEventListener('DOMContentLoaded', () => new HydroMonitor());