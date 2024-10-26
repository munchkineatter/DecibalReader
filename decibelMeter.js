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
        this.maxDecibel = 0; // Only reset maxDecibel when starting new recording
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
        console.log('[DecibelMeter] Resetting meter');
        this.readings = [];
        this.maxDecibel = 0;
        this.sessionLog = []; // Clear the session log

        // Send reset message to server if we're the recorder
        if (this.role === 'recorder' && this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('[DecibelMeter] Sending session_reset to server');
            this.ws.send(JSON.stringify({
                type: 'session_reset',
                sessionId: this.sessionId,
                clearLog: true  // Add this flag to indicate we want to clear logs
            }));
        }
    }

    async connectWebSocket(role, sessionId = null) {
        const wsUrl = 'wss://dbserver-jigl.onrender.com';
        
        try {
            this.ws = new WebSocket(wsUrl);
            this.role = role;
            console.log(`[WebSocket] Connecting as ${this.role}`);

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
                    console.log(`[WebSocket] Message received:`, data);
                    
                    switch(data.type) {
                        case 'session_created':
                            this.sessionId = data.sessionId;
                            // Remove the following line to prevent automatic recording
                            // this.isRecording = true;

                            // Clear existing session log
                            this.sessionLog = [];

                            // Load session log if provided
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
                                
                                // Update UI with existing sessions
                                this.sessionLog.forEach(session => {
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

                            // Resolve the promise with sessionId
                            resolve(this.sessionId);
                            break;

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
                                
                                // Update UI for both viewer and recorder
                                this.sessionLog.forEach(session => {
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
                        case 'session_reset':
                            console.log('[WebSocket] Received session_reset message');

                            // Clear session log and readings
                            this.sessionLog = [];
                            this.readings = [];
                            this.maxDecibel = 0;

                            // Dispatch event to update the UI
                            window.dispatchEvent(new CustomEvent('sessionReset'));
                            break;
                        case 'reset_view_log':
                            console.log('[WebSocket] Received reset_view_log message');
                            // Clear session log regardless of role
                            this.sessionLog = [];
                            // Dispatch event to update the UI
                            window.dispatchEvent(new CustomEvent('viewLogReset'));
                            break;
                        default:
                            console.warn('Unhandled message type:', data.type);
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
        // Add timestamp check to prevent duplicate readings
        const lastReading = this.readings[this.readings.length - 1];
        if (lastReading && 
            new Date(reading.time).getTime() === new Date(lastReading.time).getTime()) {
            return;
        }

        this.readings.push(reading);
        if (parseFloat(reading.value) > parseFloat(this.maxDecibel)) {
            this.maxDecibel = reading.value;
        }
        window.dispatchEvent(new CustomEvent('decibelUpdate', { 
            detail: { 
                ...reading,
                maxDecibel: this.maxDecibel
            }
        }));
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
        console.log('[DecibelMeter] Exporting sessions to CSV');
        if (!this.sessionLog || this.sessionLog.length === 0) {
            console.log('[DecibelMeter] No sessions to export');
            return;
        }

        try {
            // Create CSV header
            let csvContent = 'Session Number,Timestamp,Duration,Peak (dB),Average (dB),Minimum (dB)\n';
            
            // Add data for each session
            this.sessionLog.forEach(session => {
                csvContent += `${session.sessionNumber},${new Date(session.timestamp).toISOString()},` +
                    `${session.duration},${session.max},${session.avg},${session.min}\n`;
            });
            
            // Create and download the file
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `decibel-sessions-${new Date().toISOString()}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            
            console.log('[DecibelMeter] CSV export completed');
        } catch (error) {
            console.error('[DecibelMeter] Error exporting CSV:', error);
        }
    }

    recordSession() {
        console.log('[DecibelMeter] Recording session');
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
        
        // Only handle session recording if we're the recorder
        if (this.role === 'recorder' && this.ws) {
            console.log('[DecibelMeter] Sending session_recorded to server');
            this.ws.send(JSON.stringify({
                type: 'session_recorded',
                session: session
            }));
        }
        
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

    resetViewLog() {
        console.log('[DecibelMeter] Resetting view log');
        // Clear local session log
        this.sessionLog = [];
        
        if (this.role === 'recorder' && this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('[DecibelMeter] Sending reset_view_log to server');
            this.ws.send(JSON.stringify({
                type: 'reset_view_log',
                sessionId: this.sessionId
            }));
        }
        
        // Dispatch event to update UI
        window.dispatchEvent(new CustomEvent('viewLogReset'));
    }
}
