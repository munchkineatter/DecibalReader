document.addEventListener('DOMContentLoaded', async () => {
    const meter = new DecibelMeter();
    let chart = null;
    let animationFrame = null;

    // DOM elements
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
    const timerDuration = document.getElementById('timerDuration');
    const timerDisplay = document.getElementById('timerDisplay');
    const hideViewerControls = document.getElementById('hideViewerControls');
    const startBtn = document.getElementById('startBtn');
    const newSessionBtn = document.getElementById('newSessionBtn');
    
    let timerInterval = null;
    let remainingTime = 0;

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
                            color: 'rgba(247, 245, 242, 0.1)'
                        },
                        ticks: {
                            color: '#F7F5F2'
                        }
                    },
                    x: {
                        display: false // This hides the x-axis labels
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#F7F5F2'
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
        if (decibel !== null && decibel !== undefined) {
            document.getElementById('currentDb').textContent = parseFloat(decibel).toFixed(3);
            document.getElementById('maxDb').textContent = parseFloat(meter.maxDecibel).toFixed(3);

            chart.data.labels.push(new Date().toLocaleTimeString());
            chart.data.datasets[0].data.push(parseFloat(decibel));

            while (chart.data.labels.length > parseInt(timeRange.value) * 2) {
                chart.data.labels.shift();
                chart.data.datasets[0].data.shift();
            }

            chart.update();
        }
        
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
                <div>Peak: ${parseFloat(session.max).toFixed(3)} dB</div>
                <div>Average: ${parseFloat(session.avg).toFixed(3)} dB</div>
                <div>Minimum: ${parseFloat(session.min).toFixed(3)} dB</div>
            </div>
        `;
        logEntries.insertBefore(entryDiv, logEntries.firstChild);
    }

    // Add this function to format time for the timer display
    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    // Add this function to handle the timer
    function startTimer(duration) {
        if (!duration) return;
        
        remainingTime = duration;
        timerDisplay.classList.remove('hidden');
        timerDisplay.textContent = formatTime(remainingTime);
        
        timerInterval = setInterval(() => {
            remainingTime--;
            timerDisplay.textContent = formatTime(remainingTime);
            
            // Send timer update to viewers
            if (meter.role === 'recorder') {
                meter.updateTimer({ remainingTime });
            }
            
            if (remainingTime <= 0) {
                clearInterval(timerInterval);
                // Stop recording
                meter.stop();
                cancelAnimationFrame(animationFrame);
                
                // Record the session
                const session = meter.recordSession();
                addSessionToLog(session);
                
                // Update UI
                pauseBtn.disabled = true;
                stopBtn.disabled = true;
                resetBtn.disabled = false;
                exportBtn.disabled = false;
                startBtn.disabled = false;
                startBtn.textContent = 'Start New Session';
                timerDisplay.classList.add('hidden');
            }
        }, 1000);
    }

    // Add this function to stop the timer
    function stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        timerDisplay.classList.add('hidden');
        remainingTime = 0;
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
            const sessionId = await meter.connectWebSocket('recorder');
            sessionIdDisplay.textContent = sessionId;
            recorderControls.classList.remove('hidden');
            // Show the hide button when session starts
            hideViewerControls.classList.remove('hidden');
            
            meter.start();
            pauseBtn.disabled = false;
            stopBtn.disabled = false;
            resetBtn.disabled = true;
            
            if (!chart) {
                initializeChart();
            }
            
            updateDisplay();
            startBtn.textContent = 'Record Session';

            // Start timer if duration is selected
            const duration = parseInt(timerDuration.value);
            if (duration) {
                startTimer(duration);
            }
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

            // Enable/disable appropriate buttons
            pauseBtn.disabled = true;
            stopBtn.disabled = true;
            resetBtn.disabled = true;
            startBtn.disabled = true;
            
            // Update display for viewer mode
            document.getElementById('currentDb').textContent = '0.000';
            document.getElementById('maxDb').textContent = '0.000';
            
            // Clear any existing chart data
            chart.data.labels = [];
            chart.data.datasets[0].data = [];
            chart.update();

        } catch (error) {
            alert('Failed to join session: ' + error.message);
        }
    }

    // Update the WebSocket event listeners
    window.addEventListener('decibelUpdate', (event) => {
        const reading = event.detail;
        document.getElementById('currentDb').textContent = parseFloat(reading.value).toFixed(3);
        document.getElementById('maxDb').textContent = parseFloat(meter.maxDecibel).toFixed(3);

        chart.data.labels.push(new Date(reading.time).toLocaleTimeString());
        chart.data.datasets[0].data.push(reading.value);

        while (chart.data.labels.length > parseInt(timeRange.value) * 2) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }

        chart.update();
    });

    window.addEventListener('sessionEnded', () => {
        alert('Recording session has ended');
        location.reload();
    });

    // Event Listeners
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
            if (timerInterval) clearInterval(timerInterval); // Pause the timer
        } else {
            meter.resume();
            pauseBtn.textContent = 'Pause';
            updateDisplay();
            if (remainingTime > 0) startTimer(remainingTime); // Resume the timer
        }
    });

    stopBtn.addEventListener('click', () => {
        meter.stop();
        cancelAnimationFrame(animationFrame);
        stopTimer();
        
        pauseBtn.disabled = true;
        stopBtn.disabled = true;
        resetBtn.disabled = false;
        exportBtn.disabled = false;
        startBtn.disabled = false;
        startBtn.textContent = 'Start';
    });

    resetBtn.addEventListener('click', () => {
        meter.reset();
        stopTimer();
        chart.data.labels = [];
        chart.data.datasets[0].data = [];
        chart.update();
        
        document.getElementById('currentDb').textContent = '0';
        document.getElementById('maxDb').textContent = '0';
        
        resetBtn.disabled = true;
        exportBtn.disabled = true;
        startBtn.disabled = false;
        startBtn.textContent = 'Start';
    });

    exportBtn.addEventListener('click', () => {
        meter.exportToCsv();
    });

    // Optimize timeRange event listener
    timeRange.addEventListener('change', () => {
        if (chart && meter.isRecording) {
            chart.update();
        }
    });

    // Update the startBtn event listener
    startBtn.addEventListener('click', async () => {
        if (!meter.audioContext) {
            const initialized = await meter.initialize();
            if (!initialized) {
                alert('Failed to initialize audio. Please check your microphone permissions.');
                return;
            }
        }

        if (!meter.isRecording) {
            meter.start();
            startBtn.disabled = true;
            pauseBtn.disabled = false;
            stopBtn.disabled = false;
            resetBtn.disabled = true;
            
            if (!chart) {
                initializeChart();
            }
            
            updateDisplay();

            // Start timer if duration is selected
            const duration = parseInt(timerDuration.value);
            if (duration) {
                startTimer(duration);
            }
        }
    });

    newSessionBtn.addEventListener('click', async () => {
        try {
            const sessionId = await meter.connectWebSocket('recorder');
            sessionIdDisplay.textContent = sessionId;
            recorderControls.classList.remove('hidden');
            hideViewerControls.classList.remove('hidden');
            
            // Enable start button for the new session
            startBtn.disabled = false;
            startBtn.textContent = 'Start';
            
            // Reset other controls
            pauseBtn.disabled = true;
            stopBtn.disabled = true;
            resetBtn.disabled = true;
            
            // Reset display
            document.getElementById('currentDb').textContent = '0.000';
            document.getElementById('maxDb').textContent = '0.000';
            
            if (chart) {
                chart.data.labels = [];
                chart.data.datasets[0].data = [];
                chart.update();
            }
        } catch (error) {
            alert('Failed to create recording session: ' + error.message);
        }
    });

    hideViewerControls.addEventListener('click', () => {
        // Remove the entire session-controls element
        const sessionControlsElement = document.querySelector('.session-controls');
        if (sessionControlsElement) {
            sessionControlsElement.remove();
        }
    });

    // Add timer sync event listener
    window.addEventListener('timerSync', (event) => {
        const timerData = event.detail;
        if (timerData) {
            remainingTime = timerData.remainingTime;
            if (remainingTime > 0) {
                timerDisplay.classList.remove('hidden');
                timerDisplay.textContent = formatTime(remainingTime);
                // Only start the timer if we're not already counting
                if (!timerInterval) {
                    startTimer(remainingTime);
                }
            }
        }
    });
});
