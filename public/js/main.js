// Global variables
let socket;
let currentRoom = null;
let mediaStream = null;
let recognition = null;

// DOM Elements
const elements = {
    homeScreen: document.getElementById('homeScreen'),
    roomScreen: document.getElementById('roomScreen'),
    localVideo: document.getElementById('localVideo'),
    roomVideo: document.getElementById('roomVideo'),
    createRoomBtn: document.getElementById('createRoomBtn'),
    joinRoomBtn: document.getElementById('joinRoomBtn'),
    leaveRoomBtn: document.getElementById('leaveRoomBtn'),
    roomCodeInput: document.getElementById('roomCodeInput'),
    roomCodeDisplay: document.getElementById('roomCodeDisplay'),
    transcriptArea: document.getElementById('transcriptArea'),
    roomTranscriptArea: document.getElementById('roomTranscriptArea'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    mediaError: document.getElementById('mediaError'),
    notificationArea: document.getElementById('notificationArea'),
    userCount: document.getElementById('userCount')
};

// Initialize Socket.IO
function initializeSocket() {
    try {
        socket = io();

        socket.on('connect', () => {
            console.log('Connected to server');
            showNotification('Connected to server', 'success');
        });

        socket.on('connect_error', (error) => {
            console.error('Socket connection error:', error);
            showNotification('Connection error: ' + error.message, 'error');
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            showNotification('Disconnected from server', 'error');
        });

        socket.on('userJoined', ({ userId }) => {
            console.log('User joined:', userId);
            showNotification('New user joined the room', 'info');
            updateUserCount(1);
        });

        socket.on('userLeft', ({ userId }) => {
            console.log('User left:', userId);
            showNotification('A user left the room', 'info');
            updateUserCount(-1);
        });

        socket.on('receiveTranscript', ({ userId, text, timestamp }) => {
            console.log('Received transcript:', { userId, text, timestamp });
            addTranscriptMessage(text, 'Other', timestamp);
        });
    } catch (error) {
        console.error('Socket initialization error:', error);
        showNotification('Failed to initialize connection', 'error');
    }
}

// Media handling
async function initializeMedia() {
    try {
        showLoading(true);
        
        // Check if mediaDevices API is supported
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Media devices API is not supported in this browser');
        }

        // First try to get both video and audio
        try {
            const constraints = {
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'user'
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true
                }
            };

            mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            showNotification('Camera and microphone access granted', 'success');
        } catch (mediaError) {
            // If full access fails, try audio only
            console.warn('Full media access failed, trying audio only:', mediaError);
            try {
                mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: false,
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true
                    }
                });
                showNotification('Audio-only mode activated (no camera access)', 'info');
            } catch (audioError) {
                // If audio-only fails, continue without media devices
                console.warn('Audio-only access failed:', audioError);
                showNotification('Operating in text-only mode', 'info');
            }
        }

        // Update UI based on available media
        if (mediaStream) {
            if (mediaStream.getVideoTracks().length > 0) {
                elements.localVideo.srcObject = mediaStream;
                elements.roomVideo.srcObject = mediaStream;
                elements.mediaError.classList.add('hidden');
                
                // Wait for video to be ready
                await Promise.race([
                    new Promise(resolve => elements.localVideo.onloadedmetadata = resolve),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Video load timeout')), 5000))
                ]);
            } else {
                // Show audio-only message in video container
                elements.mediaError.classList.remove('hidden');
                elements.mediaError.innerHTML = `
                    <div class="text-center p-4">
                        <i class="fas fa-microphone text-4xl mb-2"></i>
                        <p class="text-lg">Audio-Only Mode</p>
                        <p class="text-sm mt-2">Camera access not available</p>
                    </div>
                `;
            }

            // Initialize speech recognition if we have audio
            if (mediaStream.getAudioTracks().length > 0) {
                initializeSpeechRecognition();
            }
        } else {
            // Show text-only mode message
            elements.mediaError.classList.remove('hidden');
            elements.mediaError.innerHTML = `
                <div class="text-center p-4">
                    <i class="fas fa-comment-alt text-4xl mb-2"></i>
                    <p class="text-lg">Text-Only Mode</p>
                    <p class="text-sm mt-2">Media access not available</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Media initialization error:', error);
        elements.mediaError.classList.remove('hidden');
        elements.mediaError.innerHTML = `
            <div class="text-center p-4">
                <i class="fas fa-exclamation-triangle text-4xl mb-2"></i>
                <p class="text-lg">${error.message || 'Failed to initialize media'}</p>
                <p class="text-sm mt-2">The application will continue in text-only mode</p>
            </div>
        `;
        showNotification('Continuing in text-only mode', 'info');
    } finally {
        showLoading(false);
    }
}

// Speech Recognition
function initializeSpeechRecognition() {
    try {
        // Check for various implementations of Speech Recognition API
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            throw new Error('Speech recognition is not supported in this browser');
        }

        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US'; // Set default language

        recognition.onstart = () => {
            showNotification('Voice recognition started', 'info');
        };

        recognition.onresult = (event) => {
            const result = event.results[event.results.length - 1];
            if (result.isFinal) {
                const text = result.item(0).transcript;
                addTranscriptMessage(text, 'You');
                
                if (currentRoom) {
                    socket.emit('sendTranscript', {
                        roomId: currentRoom,
                        text: text
                    });
                }
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            let errorMessage = 'Speech recognition error';
            
            switch (event.error) {
                case 'network':
                    errorMessage = 'Network error occurred. Please check your connection.';
                    break;
                case 'not-allowed':
                    errorMessage = 'Microphone access denied. Please check permissions.';
                    break;
                case 'no-speech':
                    errorMessage = 'No speech detected. Please try again.';
                    break;
                default:
                    errorMessage = `Speech recognition error: ${event.error}`;
            }
            
            showNotification(errorMessage, 'error');
        };

        recognition.onend = () => {
            // Attempt to restart recognition if it ends unexpectedly
            if (currentRoom) {
                recognition.start();
            }
        };

        recognition.start();
    } catch (error) {
        console.error('Speech recognition initialization error:', error);
        showNotification(error.message, 'error');
    }
}

// Room Management
async function createRoom() {
    try {
        showLoading(true);
        
        // Check if socket is connected
        if (!socket || !socket.connected) {
            throw new Error('Not connected to server');
        }

        // Create room with Promise wrapper for better error handling
        await new Promise((resolve, reject) => {
            socket.emit('createRoom', (response) => {
                if (response.success) {
                    currentRoom = response.roomId;
                    elements.roomCodeDisplay.textContent = currentRoom;
                    switchToRoomScreen();
                    showNotification('Room created successfully', 'success');
                    resolve();
                } else {
                    reject(new Error(response.error || 'Failed to create room'));
                }
            });

            // Add timeout for room creation
            setTimeout(() => {
                reject(new Error('Room creation timeout'));
            }, 5000);
        });
    } catch (error) {
        console.error('Room creation error:', error);
        showNotification(error.message, 'error');
    } finally {
        showLoading(false);
    }
}


async function joinRoom() {
    const roomId = elements.roomCodeInput.value.trim();
    if (!roomId) {
        showNotification('Please enter a room code', 'error');
        return;
    }

    try {
        showLoading(true);
        socket.emit('joinRoom', roomId, (response) => {
            if (response.success) {
                currentRoom = roomId;
                elements.roomCodeDisplay.textContent = currentRoom;
                switchToRoomScreen();
                showNotification('Joined room successfully', 'success');
            } else {
                showNotification('Failed to join room: ' + response.error, 'error');
            }
            showLoading(false);
        });
    } catch (error) {
        showNotification('Error joining room', 'error');
        showLoading(false);
    }
}

function leaveRoom() {
    if (currentRoom) {
        socket.emit('leaveRoom', currentRoom);
        currentRoom = null;
        switchToHomeScreen();
        showNotification('Left the room', 'info');
    }
}

// UI Helpers
function switchToRoomScreen() {
    elements.homeScreen.classList.add('hidden');
    elements.roomScreen.classList.remove('hidden');
}

function switchToHomeScreen() {
    elements.homeScreen.classList.remove('hidden');
    elements.roomScreen.classList.add('hidden');
    elements.roomTranscriptArea.innerHTML = '';
    elements.userCount.textContent = '1';
}

function addTranscriptMessage(text, sender, timestamp = new Date().toISOString()) {
    const messageElement = document.createElement('div');
    messageElement.className = `transcript-message ${sender === 'You' ? 'self' : 'other'}`;
    
    const time = new Date(timestamp).toLocaleTimeString();
    const icon = sender === 'You' ? 'fa-user' : 'fa-user-friends';
    
    messageElement.innerHTML = `
        <div class="flex justify-between items-start mb-1">
            <div class="flex items-center">
                <i class="fas ${icon} text-gray-500 mr-2"></i>
                <span class="font-medium text-sm">${sender}</span>
            </div>
            <span class="text-xs text-gray-500">${time}</span>
        </div>
        <p class="text-gray-800 break-words">${text}</p>
    `;

    const targetArea = currentRoom ? elements.roomTranscriptArea : elements.transcriptArea;
    targetArea.appendChild(messageElement);
    
    // Smooth scroll to bottom
    targetArea.scrollTo({
        top: targetArea.scrollHeight,
        behavior: 'smooth'
    });
    
    // Remove old messages if there are too many (keep last 50)
    const messages = targetArea.getElementsByClassName('transcript-message');
    while (messages.length > 50) {
        messages[0].remove();
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    const bgColor = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        info: 'bg-blue-500'
    }[type];

    const icon = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle'
    }[type];

    notification.className = `notification ${bgColor} text-white px-6 py-3 rounded-lg shadow-lg flex items-center space-x-3`;
    notification.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;

    elements.notificationArea.appendChild(notification);
    
    // Fade out and remove after delay
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    }, 3000);

    // Remove old notifications if there are too many (keep last 3)
    const notifications = elements.notificationArea.getElementsByClassName('notification');
    while (notifications.length > 3) {
        notifications[0].remove();
    }
}

function showLoading(show) {
    elements.loadingOverlay.classList.toggle('hidden', !show);
}

function updateUserCount(change) {
    const currentCount = parseInt(elements.userCount.textContent);
    elements.userCount.textContent = currentCount + change;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    initializeSocket();
    initializeMedia();

    elements.createRoomBtn.addEventListener('click', createRoom);
    elements.joinRoomBtn.addEventListener('click', joinRoom);
    elements.leaveRoomBtn.addEventListener('click', leaveRoom);
    
    elements.roomCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }
    if (recognition) {
        recognition.stop();
    }
    if (currentRoom) {
        socket.emit('leaveRoom', currentRoom);
    }
});
