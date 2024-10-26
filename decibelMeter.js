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
    }

    pause() {
        this.isRecording = false;
    }

    resume() {
        this.isRecording = true;
    }

    stop() {
        this.isRecording = false;
    }

    reset() {
        this.readings = [];
        this.maxDecibel = 0;
    }

    async connectWebSocket(role, sessionId = null) {
        const wsUrl = 'wss://dbserver-1-jchv.onrender.com';
        console.log('Connecting to WebSocket:', wsUrl);
        
        this.ws = new WebSocket(wsUrl);
        this.role = role;

        return new Promise((resolve, reject) => {
            this.ws.onopen = () => {
                console.log('WebSocket connected!');
                if (role === 'recorder') {
                    console.log('Sending create_session request');
                    this.ws.send(JSON.stringify({
                        type: 'create_session'
                    }));
                } else {
                    console.log('Sending join_session request:', sessionId);
                    this.ws.send(JSON.stringify({
                        type: 'join_session',
                        sessionId
                    }));
                }
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                switch(data.type) {
                    case 'session_joined':
                        this.sessionId = sessionId;
                        this.isRecording = data.isActive;
                        
                        // Clear existing session log
                        this.sessionLog = [];
                        
                        // Load unique sessions from server
                        if (data.sessionLog && Array.isArray(data.sessionLog)) {
                            // Create a Map to ensure uniqueness by ID
                            const uniqueSessions = new Map();
                            data.sessionLog.forEach(session => {
                                if (!uniqueSessions.has(session.id)) {
                                    uniqueSessions.set(session.id, session);
                                }
                            });
                            
                            // Convert Map back to array and sort by timestamp
                            this.sessionLog = Array.from(uniqueSessions.values())
                                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                            
                            // Update UI for each unique session
                            if (this.role === 'viewer') {
                                this.sessionLog.forEach(session => {
                                    window.dispatchEvent(new CustomEvent('sessionLogged', {
                                        detail: session
                                    }));
                                });
                            }
                        }
                        
                        if (data.timerData) {
                            window.dispatchEvent(new CustomEvent('timerSync', { 
                                detail: data.timerData 
                            }));
                        }
                        resolve(this.sessionId);
                        break;
                        
                    case 'session_recorded':
                        // Only add if not already in the log
                        const sessionExists = this.sessionLog.some(s => s.id === data.session.id);
                        if (!sessionExists) {
                            this.sessionLog.push(data.session);
                            window.dispatchEvent(new CustomEvent('sessionLogged', {
                                detail: data.session
                            }));
                        }
                        break;
                    case 'decibel_update':
                        if (this.role === 'viewer') {
                            this.handleDecibelUpdate(data.data);
                        }
                        break;
                    case 'error':
                        reject(new Error(data.message));
                        break;
                    case 'session_ended':
                        if (this.role === 'viewer') {
                            this.handleSessionEnded();
                        }
                        break;
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            };

            this.ws.onclose = () => {
                console.log('WebSocket connection closed');
            };
        });
    }

    getCurrentDecibel() {
        if (!this.analyzer || !this.isRecording) return 0;

        this.analyzer.getByteFrequencyData(this.dataArray);
        const average = this.dataArray.reduce((acc, val) => acc + val, 0) / this.dataArray.length;
        // Convert to number immediately
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
    }

    handleDecibelUpdate(reading) {
        this.readings.push(reading);
        // Convert to number for comparison
        if (parseFloat(reading.value) > parseFloat(this.maxDecibel)) {
            this.maxDecibel = reading.value;
        }
        // Trigger custom event for UI update
        window.dispatchEvent(new CustomEvent('decibelUpdate', { detail: reading }));
    }

    handleSessionEnded() {
        this.isRecording = false;
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
            duration: this.readings.length > 0 ? 
                (this.readings[this.readings.length - 1].time - this.readings[0].time) / 1000 : 0,
            max: sessionData.max,
            avg: sessionData.avg,
            min: sessionData.min
        };
        
        this.sessionLog.push(session);
        this.readings = [];
        this.maxDecibel = 0;
        
        return session;
    }
}
