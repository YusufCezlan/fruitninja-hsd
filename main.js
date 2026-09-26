// --- KONFİGÜRASYON VE DEĞİŞKENLER ---
const canvasElement = document.getElementById('gameCanvas');
const canvasCtx = canvasElement.getContext('2d');
const videoElement = document.getElementById('input_video');
const loadingDiv = document.getElementById('loading');
const gameOverDiv = document.getElementById('game-over');
const scoreValSpan = document.getElementById('scoreVal');
const livesValSpan = document.getElementById('livesVal');
const finalScoreSpan = document.getElementById('finalScoreVal');

// Tam Ekran Ayarları
let WIDTH = window.innerWidth;
let HEIGHT = window.innerHeight;

function resizeCanvas() {
    WIDTH = window.innerWidth;
    HEIGHT = window.innerHeight;
    canvasElement.width = WIDTH;
    canvasElement.height = HEIGHT;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Oyun Durumu
let score = 0;
let lives = 10;
let isGameOver = false;
let isMediaPipeReady = false;

// Meyve ve Bomba Tanımları
const objects = [];
const fruitTypes = [
    { type: 'fruit', name: 'Karpuz', mainColor: '#27ae60', innerColor: '#e74c3c', score: 15, radius: 75, icon: '🍉' },
    { type: 'fruit', name: 'Portakal', mainColor: '#e67e22', innerColor: '#f39c12', score: 10, radius: 65, icon: '🍊' },
    { type: 'fruit', name: 'Limon', mainColor: '#f1c40f', innerColor: '#f39c12', score: 10, radius: 60, icon: '🍋' },
    { type: 'fruit', name: 'Elma', mainColor: '#c0392b', innerColor: '#e74c3c', score: 10, radius: 62, icon: '🍎' }
];

// El Takibi ve Katana Değişkenleri
let handX = null;
let handY = null;
let lastHandX = null;
let lastHandY = null;
let bladeAngle = 0;
let isFistClosed = false;
let lastSeenHandTime = 0;
const bladeTrail = [];

// --- 1. MEDIAPIPE HANDS KURULUMU ---
const hands = new Hands({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});

hands.onResults(onResults);

// --- 2. KAMERA KURULUMU ---
const camera = new Camera(videoElement, {
    onFrame: async () => {
        await hands.send({image: videoElement});
    },
    width: 1280,
    height: 720
});

camera.start().then(() => {
    console.log("Kamera aktif.");
});

// --- 3. OYUN DÖNGÜSÜ ---
let lastSpawnTime = 0;
function gameLoop(timestamp) {
    if (isGameOver || !isMediaPipeReady) return;

    drawBackground();

    // 1.3 Saniyede Bir Dalga Fırlatma
    if (timestamp - lastSpawnTime > 1300) {
        spawnWave();
        lastSpawnTime = timestamp;
    }

    for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        
        obj.x += obj.vx;
        obj.y += obj.vy;
        obj.vy += obj.gravity;
        obj.rotation += obj.vRot;

        drawObject(obj);

        // Kesme Kontrolü
        if (checkSlice(obj)) {
            objects.splice(i, 1);
            continue;
        }

        // Ekrandan Düşme / Kaçırma Kontrolü
        if (obj.y > HEIGHT + 150 || obj.x < -180 || obj.x > WIDTH + 180) {
            // Kaçırılan Meyve -> 1 Can Götürür
            if (obj.type === 'fruit') {
                lives--;
                updateUI();
                if (lives <= 0) endGame();
            }
            objects.splice(i, 1);
        }
    }

    drawKatanaAndHand();

    requestAnimationFrame(gameLoop);
}

// --- 4. EN YAKIN ELİ SEÇME ALGORİTMASI ---
function onResults(results) {
    if (!isMediaPipeReady) {
        isMediaPipeReady = true;
        loadingDiv.classList.add('hidden');
        requestAnimationFrame(gameLoop);
    }

    const now = Date.now();

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        lastSeenHandTime = now;
        
        let closestHand = results.multiHandLandmarks[0];
        let maxHandArea = 0;

        for (const landmarks of results.multiHandLandmarks) {
            let minX = 1, maxX = 0, minY = 1, maxY = 0;
            for (const lm of landmarks) {
                if (lm.x < minX) minX = lm.x;
                if (lm.x > maxX) maxX = lm.x;
                if (lm.y < minY) minY = lm.y;
                if (lm.y > maxY) maxY = lm.y;
            }
            const area = (maxX - minX) * (maxY - minY);
            if (area > maxHandArea) {
                maxHandArea = area;
                closestHand = landmarks;
            }
        }

        const palmX = (1 - closestHand[9].x) * WIDTH;
        const palmY = closestHand[9].y * HEIGHT;

        if (handX === null) {
            handX = palmX;
            handY = palmY;
        } else {
            lastHandX = handX;
            lastHandY = handY;
            handX += (palmX - handX) * 0.65;
            handY += (palmY - handY) * 0.65;

            const dx = handX - lastHandX;
            const dy = handY - lastHandY;
            if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) {
                bladeAngle = Math.atan2(dy, dx);
            }
        }

        const wrist = closestHand[0];
        const indexTip = closestHand[8];
        const middleTip = closestHand[12];
        const ringTip = closestHand[16];

        const distIndex = Math.hypot(indexTip.x - wrist.x, indexTip.y - wrist.y);
        const distMiddle = Math.hypot(middleTip.x - wrist.x, middleTip.y - wrist.y);
        const distRing = Math.hypot(ringTip.x - wrist.x, ringTip.y - wrist.y);

        isFistClosed = (distIndex < 0.35 && distMiddle < 0.35 && distRing < 0.35);

        bladeTrail.push({ x: handX, y: handY });
        if (bladeTrail.length > 16) bladeTrail.shift();

    } else {
        if (now - lastSeenHandTime > 1200) {
            bladeTrail.length = 0;
            handX = null;
            handY = null;
            isFistClosed = false;
        }
    }
}

// --- 5. FARKLI YÖNLERDEN FIRLATMA VE DİNAMİK BOMBA MANTIĞI ---

function spawnWave() {
    // Aynı anda 1 ile 3 arası nesne fırlat
    const count = Math.floor(Math.random() * 3) + 1;
    const bombChance = (count === 1) ? 0.12 : 0.02;

    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const isBomb = Math.random() < bombChance;
            spawnObject(isBomb);
        }, i * 160);
    }
}

function spawnObject(isBomb) {
    const side = Math.random();
    let x, y, vx, vy, gravity;

    if (side < 0.4) {
        // Alt taraftan yukarıya
        x = WIDTH * (0.2 + Math.random() * 0.6);
        y = HEIGHT + 60;
        vx = (Math.random() - 0.5) * 6;
        vy = -(Math.random() * 3 + 14);
        gravity = 0.20;
    } else if (side < 0.7) {
        // Sol kenardan sağ/yukarı çapraz
        x = -60;
        y = HEIGHT * (0.35 + Math.random() * 0.45);
        vx = Math.random() * 6 + 8;
        vy = -(Math.random() * 4 + 7);
        gravity = 0.18;
    } else {
        // Sağ kenardan sol/yukarı çapraz
        x = WIDTH + 60;
        y = HEIGHT * (0.35 + Math.random() * 0.45);
        vx = -(Math.random() * 6 + 8);
        vy = -(Math.random() * 4 + 7);
        gravity = 0.18;
    }

    let obj;
    if (isBomb) {
        obj = {
            type: 'bomb',
            x, y, vx, vy, gravity,
            radius: 50,
            rotation: 0,
            vRot: (Math.random() - 0.5) * 0.05
        };
    } else {
        const typeDef = fruitTypes[Math.floor(Math.random() * fruitTypes.length)];
        obj = {
            ...typeDef,
            x, y, vx, vy, gravity,
            rotation: 0,
            vRot: (Math.random() - 0.5) * 0.1
        };
    }
    objects.push(obj);
}

function checkSlice(obj) {
    if (handX === null || handY === null) return false;

    const dx = handX - obj.x;
    const dy = handY - obj.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < obj.radius + 130) {
        if (obj.type === 'fruit') {
            score += obj.score;
        } else if (obj.type === 'bomb') {
            score = Math.max(0, score - 5);
            lives -= 5; // Bombaya vurunca 5 CAN gider
            if (lives <= 0) endGame();
        }
        updateUI();
        return true;
    }
    return false;
}

function drawBackground() {
    canvasCtx.fillStyle = '#0f172a';
    canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);

    canvasCtx.fillStyle = 'rgba(230, 57, 70, 0.12)';
    const spacing = 45;
    for (let x = 22; x < WIDTH; x += spacing) {
        for (let y = 22; y < HEIGHT; y += spacing) {
            canvasCtx.beginPath();
            canvasCtx.arc(x, y, 4, 0, Math.PI * 2);
            canvasCtx.fill();
        }
    }

    canvasCtx.save();
    canvasCtx.font = `bold ${Math.min(WIDTH, HEIGHT) * 0.18}px sans-serif`;
    canvasCtx.textAlign = 'center';
    canvasCtx.textBaseline = 'middle';
    canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    canvasCtx.fillText('<HSD>', WIDTH / 2, HEIGHT / 2);
    canvasCtx.restore();
}

function drawObject(obj) {
    canvasCtx.save();
    canvasCtx.translate(obj.x, obj.y);
    canvasCtx.rotate(obj.rotation);

    if (obj.type === 'bomb') {
        canvasCtx.beginPath();
        canvasCtx.arc(0, 0, obj.radius, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#1e293b';
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#ef4444';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();

        canvasCtx.beginPath();
        canvasCtx.moveTo(0, -obj.radius);
        canvasCtx.quadraticCurveTo(15, -obj.radius - 15, 10, -obj.radius - 25);
        canvasCtx.strokeStyle = '#d97706';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();

        canvasCtx.beginPath();
        canvasCtx.arc(10, -obj.radius - 25, 8 + Math.random() * 4, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#f59e0b';
        canvasCtx.fill();
    } else {
        canvasCtx.beginPath();
        canvasCtx.arc(0, 0, obj.radius, 0, Math.PI * 2);
        canvasCtx.fillStyle = obj.mainColor;
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#ffffff';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();

        canvasCtx.beginPath();
        canvasCtx.arc(0, 0, obj.radius * 0.75, 0, Math.PI * 2);
        canvasCtx.fillStyle = obj.innerColor;
        canvasCtx.fill();

        canvasCtx.font = `${obj.radius * 0.9}px sans-serif`;
        canvasCtx.textAlign = 'center';
        canvasCtx.textBaseline = 'middle';
        canvasCtx.fillText(obj.icon, 0, 0);
    }

    canvasCtx.restore();
}

function drawKatanaAndHand() {
    if (handX === null || handY === null) return;

    if (bladeTrail.length >= 2) {
        canvasCtx.save();
        canvasCtx.beginPath();
        canvasCtx.moveTo(bladeTrail[0].x, bladeTrail[0].y);
        for (let i = 1; i < bladeTrail.length; i++) {
            canvasCtx.lineTo(bladeTrail[i].x, bladeTrail[i].y);
        }
        canvasCtx.strokeStyle = isFistClosed ? '#ef4444' : '#38bdf8';
        canvasCtx.lineWidth = 28;
        canvasCtx.lineCap = 'round';
        canvasCtx.shadowColor = isFistClosed ? '#f59e0b' : '#0284c7';
        canvasCtx.shadowBlur = 35;
        canvasCtx.stroke();
        canvasCtx.restore();
    }

    canvasCtx.save();
    canvasCtx.translate(handX, handY);
    canvasCtx.rotate(bladeAngle + Math.PI / 4);

    canvasCtx.fillStyle = '#000000';
    canvasCtx.fillRect(-12, 18, 24, 60);
    canvasCtx.fillStyle = '#f59e0b';
    canvasCtx.fillRect(-22, 10, 44, 12);

    canvasCtx.beginPath();
    canvasCtx.moveTo(-10, 10);
    canvasCtx.lineTo(-4, -240);
    canvasCtx.lineTo(12, -220);
    canvasCtx.lineTo(10, 10);
    canvasCtx.closePath();

    canvasCtx.fillStyle = isFistClosed ? '#ffffff' : 'rgba(255, 255, 255, 0.85)';
    canvasCtx.shadowColor = isFistClosed ? '#ef4444' : '#38bdf8';
    canvasCtx.shadowBlur = 30;
    canvasCtx.fill();

    canvasCtx.font = '42px sans-serif';
    canvasCtx.textAlign = 'center';
    canvasCtx.textBaseline = 'middle';
    canvasCtx.fillText(isFistClosed ? '✊' : '🖐️', 0, 105);

    canvasCtx.restore();
}

function updateUI() {
    scoreValSpan.innerText = score;
    livesValSpan.innerText = Math.max(0, lives);
}

function endGame() {
    isGameOver = true;
    finalScoreSpan.innerText = score;
    gameOverDiv.classList.remove('hidden');
}

function resetGame() {
    score = 0;
    lives = 10;
    isGameOver = false;
    objects.length = 0;
    bladeTrail.length = 0;
    gameOverDiv.classList.add('hidden');
    updateUI();
    requestAnimationFrame(gameLoop);
}
