class DecibelMeter {
    constructor() {
        this.audioContext = null;
        this.mediaStream = null;
        this.analyzer = null;
        this.dataArray = null;
        this.isRecording = false;
        this.readings = [];
        this.maxDecibel = 0;
        this.sessionLog = [];
        this.ws = null;
        this.sessionId = null;
        this.role = null;
    }

    async initialize() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.analyzer = this.audioContext.createAnalyser();
            this.analyzer.fftSize = 2048;
            
            source.connect(this.analyzer);
            this.dataArray = new Uint8Array(this.analyzer.frequencyBinCount);
            
            return true;
        } catch (error) {
            console.error('Error initializing audio:', error);
            return false;
        }
    }

    start() {
        this.isRecording = true;
        this.readings = [];
        this.maxDecibel = 0;
        // Make sure analyzer is ready
        if (!this.analyzer && this.audioContext) {
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.analyzer = this.audioContext.createAnalyser();
            this.analyzer.fftSize = 2048;
            source.connect(this.analyzer);
            this.dataArray = new Uint8Array(this.analyzer.frequencyBinCount);
        }
    }

    pause() {
        this.isRecording = false;
    }

    resume() {
        this.isRecording = true;
    }

    stop() {
        this.isRecording = false;
        // Don't disconnect or reset analyzer
    }

    reset() {
        this.readings = [];
        this.maxDecibel = 0;
        // Don't reset the analyzer or connection
    }

    async connectWebSocket(role, sessionId = null) {
        const wsUrl = 'wss://dbserver-jigl.onrender.com';
        
        try {
            this.ws = new WebSocket(wsUrl);
            this.role = role;

            return new Promise((resolve, reject) => {
                this.ws.onopen = () => {
                    if (role === 'recorder') {
                        this.ws.send(JSON.stringify({
                            type: 'create_session'
                        }));
                    } else if (role === 'viewer') {
                        this.ws.send(JSON.stringify({
                            type: 'join_session',
                            sessionId: sessionId
                        }));
                    }
                };

                this.ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    
                    switch(data.type) {
                        case 'session_created':
                            this.sessionId = data.sessionId;
                            this.isRecording = false; // Initialize as not recording
                            resolve(this.sessionId);
                            break;
                        case 'session_joined':
                            this.sessionId = sessionId;
                            this.isRecording = data.isActive;
                            // Load existing session log
                            if (data.sessionLog) {
                                this.sessionLog = data.sessionLog;
                                // Update UI for each session
                                data.sessionLog.forEach(session => {
                                    window.dispatchEvent(new CustomEvent('sessionLogged', {
                                        detail: session
                                    }));
                                });
                            }
                            if (data.timerData) {
                                window.dispatchEvent(new CustomEvent('timerSync', { 
                                    detail: data.timerData 
                                }));
                            }
                            resolve(this.sessionId);
                            break;
                        case 'decibel_update':
                            this.handleDecibelUpdate(data.data);
                            break;
                        case 'error':
                            reject(new Error(data.message));
                            break;
                        case 'session_ended':
                            this.handleSessionEnded();
                            break;
                        case 'timer_update':
                            window.dispatchEvent(new CustomEvent('timerSync', { 
                                detail: data.timerData 
                            }));
                            break;
                        case 'session_recorded':
                            if (this.role === 'viewer') {
                                this.sessionLog.push(data.session);
                                window.dispatchEvent(new CustomEvent('sessionLogged', {
                                    detail: data.session
                                }));
                            }
                            break;
                    }
                };

                this.ws.onerror = (error) => {
                    reject(new Error('WebSocket connection failed'));
                };

                this.ws.onclose = () => {
                    if (this.role === 'viewer') {
                        this.handleSessionEnded();
                    }
                };
            });
        } catch (error) {
            throw new Error('Failed to connect to WebSocket server');
        }
    }

    getCurrentDecibel() {
        if (!this.analyzer || !this.isRecording) return 0;

        try {
            this.analyzer.getByteFrequencyData(this.dataArray);
            const average = this.dataArray.reduce((acc, val) => acc + val, 0) / this.dataArray.length;
            const decibel = parseFloat(((average / 255) * 100).toFixed(3));
            
            if (decibel > parseFloat(this.maxDecibel)) {
                this.maxDecibel = decibel;
            }

            if (this.isRecording) {
                const reading = {
                    time: new Date(),
                    value: decibel
                };
                this.readings.push(reading);

                // Send data if we're the recorder
                if (this.role === 'recorder' && this.ws) {
                    this.ws.send(JSON.stringify({
                        type: 'decibel_data',
                        data: reading
                    }));
                }
            }

            return decibel;
        } catch (error) {
            console.error('Error getting decibel data:', error);
            return 0;
        }
    }

    handleDecibelUpdate(reading) {
        // Remove the role check since we want to handle updates for all viewers
        this.readings.push(reading);
        if (parseFloat(reading.value) > parseFloat(this.maxDecibel)) {
            this.maxDecibel = reading.value;
        }
        // Always dispatch the event for UI updates
        window.dispatchEvent(new CustomEvent('decibelUpdate', { detail: reading }));
    }

    handleSessionEnded() {
        this.isRecording = false;
        if (this.ws) {
            this.ws.close();
        }
        window.dispatchEvent(new CustomEvent('sessionEnded'));
    }

    getSessionData() {
        return {
            readings: this.readings,
            max: parseFloat(this.maxDecibel).toFixed(3),
            avg: (this.readings.reduce((acc, reading) => acc + reading.value, 0) / this.readings.length).toFixed(3),
            min: Math.min(...this.readings.map(reading => reading.value)).toFixed(3)
        };
    }

    exportToCsv() {
        // Create CSV header
        let csvContent = 'Session Number,Timestamp,Duration,Peak (dB),Average (dB),Minimum (dB)\n';
        
        // Add data for each session
        this.sessionLog.forEach(session => {
            csvContent += `${session.sessionNumber},${session.timestamp.toISOString()},` +
                `${session.duration},${session.max},${session.avg},${session.min}\n`;
        });
        
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `decibel-sessions-${new Date().toISOString()}.csv`;
        a.click();
        
        window.URL.revokeObjectURL(url);
    }

    recordSession() {
        const sessionData = this.getSessionData();
        const session = {
            sessionNumber: this.sessionLog.length + 1,
            id: Date.now(),
            timestamp: new Date(),
            duration: this.calculateDuration(),
            max: sessionData.max,
            avg: sessionData.avg,
            min: sessionData.min
        };
        
        this.sessionLog.push(session);
        
        // Send session to server if we're the recorder
        if (this.role === 'recorder' && this.ws) {
            this.ws.send(JSON.stringify({
                type: 'session_recorded',
                session: session
            }));
        }
        
        // Reset readings and maxDecibel but maintain connection
        this.readings = [];
        this.maxDecibel = 0;
        
        return session;
    }

    updateTimer(timerData) {
        if (this.ws && this.role === 'recorder') {
            this.ws.send(JSON.stringify({
                type: 'timer_update',
                timerData
            }));
        }
    }

    disconnectSession() {
        if (this.ws) {
            // Send disconnect message to server
            this.ws.send(JSON.stringify({
                type: 'disconnect_session'
            }));
            this.ws.close();
            this.ws = null;
            this.sessionId = null;
            this.role = null;
            this.isRecording = false;
        }
    }

    // Add new method to calculate duration
    calculateDuration() {
        if (this.readings.length < 2) return 0;
        const start = new Date(this.readings[0].time).getTime();
        const end = new Date(this.readings[this.readings.length - 1].time).getTime();
        return (end - start) / 1000; // Duration in seconds
    }
}
