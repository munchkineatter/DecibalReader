document.addEventListener('DOMContentLoaded', async () => {
    const meter = new DecibelMeter();
    let chart = null;
    let animationFrame = null;

    // DOM elements
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const stopBtn = document.getElementById('stopBtn');
    const resetBtn = document.getElementById('resetBtn');
    const exportBtn = document.getElementById('exportBtn');
    const timeRange = document.getElementById('timeRange');
    const recordBtn = document.getElementById('recordBtn');
    const logEntries = document.getElementById('logEntries');
    const recorderControls = document.getElementById('recorderControls');
    const viewerControls = document.getElementById('viewerControls');
    const sessionIdDisplay = document.getElementById('sessionIdDisplay');
    const copySessionId = document.getElementById('copySessionId');
    const sessionIdInput = document.getElementById('sessionIdInput');
    const joinSession = document.getElementById('joinSession');
    
    // Initialize Chart.js
    function initializeChart() {
        const ctx = document.getElementById('decibelGraph').getContext('2d');
        chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Decibel Level',
                    data: [],
                    borderColor: '#007DBA',
                    backgroundColor: 'rgba(0, 125, 186, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        grid: {
                            color: 'rgba(247, 245, 242, 0.1)' // Light colored grid
                        },
                        ticks: {
                            color: '#F7F5F2' // White text
                        }
                    },
                    x: {
                        grid: {
                            color: 'rgba(247, 245, 242, 0.1)' // Light colored grid
                        },
                        ticks: {
                            color: '#F7F5F2' // White text
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#F7F5F2' // White text for legend
                        }
                    }
                },
                animation: {
                    duration: 0
                }
            }
        });
    }

    function updateDisplay() {
        if (!meter.isRecording) return;

        const decibel = meter.getCurrentDecibel();
        document.getElementById('currentDb').textContent = decibel;
        document.getElementById('maxDb').textContent = meter.maxDecibel;

        // Update chart
        const timeRangeValue = parseInt(timeRange.value);
        const now = new Date();
        
        chart.data.labels.push(now.toLocaleTimeString());
        chart.data.datasets[0].data.push(decibel);

        // Remove old data points
        while (chart.data.labels.length > timeRangeValue * 2) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }

        chart.update();
        animationFrame = requestAnimationFrame(updateDisplay);
    }

    function formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function addSessionToLog(session) {
        const entryDiv = document.createElement('div');
        entryDiv.className = 'log-entry';
        entryDiv.innerHTML = `
            <h3>Session #${session.sessionNumber} - ${session.timestamp.toLocaleTimeString()}</h3>
            <div class="log-entry-stats">
                <div>Duration: ${formatDuration(session.duration)}s</div>
                <div>Peak: ${session.max} dB</div>
                <div>Average: ${session.avg} dB</div>
                <div>Minimum: ${session.min} dB</div>
            </div>
        `;
        logEntries.insertBefore(entryDiv, logEntries.firstChild);
    }

    async function startRecording() {
        if (!meter.audioContext) {
            const initialized = await meter.initialize();
            if (!initialized) {
                alert('Failed to initialize audio. Please check your microphone permissions.');
                return;
            }
        }

        try {
            // Connect as recorder
            const sessionId = await meter.connectWebSocket('recorder');
            sessionIdDisplay.textContent = sessionId;
            recorderControls.classList.remove('hidden');
            viewerControls.classList.add('hidden');

            meter.start();
            startBtn.disabled = true;
            pauseBtn.disabled = false;
            stopBtn.disabled = false;
            resetBtn.disabled = true;
            
            if (!chart) {
                initializeChart();
            }
            
            updateDisplay();
            recordBtn.disabled = false;
        } catch (error) {
            alert('Failed to create recording session: ' + error.message);
        }
    }

    async function joinViewerSession() {
        const sessionId = sessionIdInput.value.trim();
        if (!sessionId) {
            alert('Please enter a session ID');
            return;
        }

        try {
            await meter.connectWebSocket('viewer', sessionId);
            viewerControls.classList.add('hidden');
            
            if (!chart) {
                initializeChart();
            }

            // Listen for decibel updates
            window.addEventListener('decibelUpdate', (event) => {
                const reading = event.detail;
                document.getElementById('currentDb').textContent = reading.value;
                document.getElementById('maxDb').textContent = meter.maxDecibel;

                chart.data.labels.push(new Date(reading.time).toLocaleTimeString());
                chart.data.datasets[0].data.push(reading.value);

                while (chart.data.labels.length > parseInt(timeRange.value) * 2) {
                    chart.data.labels.shift();
                    chart.data.datasets[0].data.shift();
                }

                chart.update();
            });

            // Listen for session end
            window.addEventListener('sessionEnded', () => {
                alert('Recording session has ended');
                location.reload();
            });

        } catch (error) {
            alert('Failed to join session: ' + error.message);
        }
    }

    // Event Listeners
    startBtn.addEventListener('click', startRecording);
    joinSession.addEventListener('click', joinViewerSession);

    copySessionId.addEventListener('click', () => {
        navigator.clipboard.writeText(sessionIdDisplay.textContent)
            .then(() => alert('Session ID copied to clipboard'))
            .catch(err => console.error('Failed to copy:', err));
    });

    pauseBtn.addEventListener('click', () => {
        if (meter.isRecording) {
            meter.pause();
            pauseBtn.textContent = 'Resume';
            cancelAnimationFrame(animationFrame);
        } else {
            meter.resume();
            pauseBtn.textContent = 'Pause';
            updateDisplay();
        }
    });

    stopBtn.addEventListener('click', () => {
        meter.stop();
        cancelAnimationFrame(animationFrame);
        
        const sessionData = meter.getSessionData();
        document.getElementById('peakDb').textContent = sessionData.max;
        document.getElementById('avgDb').textContent = sessionData.avg;
        document.getElementById('minDb').textContent = sessionData.min;
        
        startBtn.disabled = false;
        pauseBtn.disabled = true;
        stopBtn.disabled = true;
        resetBtn.disabled = false;
        exportBtn.disabled = false;
        recordBtn.disabled = true;
    });

    resetBtn.addEventListener('click', () => {
        meter.reset();
        chart.data.labels = [];
        chart.data.datasets[0].data = [];
        chart.update();
        
        document.getElementById('currentDb').textContent = '0';
        document.getElementById('maxDb').textContent = '0';
        document.getElementById('peakDb').textContent = '0';
        document.getElementById('avgDb').textContent = '0';
        document.getElementById('minDb').textContent = '0';
        
        resetBtn.disabled = true;
        exportBtn.disabled = true;
        recordBtn.disabled = true;
    });

    exportBtn.addEventListener('click', () => {
        meter.exportToCsv();
    });

    timeRange.addEventListener('change', () => {
        if (chart) {
            chart.data.labels = [];
            chart.data.datasets[0].data = [];
            chart.update();
        }
    });

    recordBtn.addEventListener('click', () => {
        const session = meter.recordSession();
        addSessionToLog(session);
    });
});
