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
let lives = 3;
let isGameOver = false;
let isMediaPipeReady = false;

// Gelişmiş Meyveler ve Bombalar
const objects = [];
const fruitTypes = [
    { type: 'fruit', name: 'Karpuz', mainColor: '#27ae60', innerColor: '#e74c3c', score: 15, radius: 65, icon: '🍉' },
    { type: 'fruit', name: 'Portakal', mainColor: '#e67e22', innerColor: '#f39c12', score: 10, radius: 55, icon: '🍊' },
    { type: 'fruit', name: 'Limon', mainColor: '#f1c40f', innerColor: '#f39c12', score: 10, radius: 50, icon: '🍋' },
    { type: 'fruit', name: 'Elma', mainColor: '#c0392b', innerColor: '#e74c3c', score: 10, radius: 52, icon: '🍎' }
];

// El Takibi ve Katana Değişkenleri
let handX = null;
let handY = null;
let lastHandX = null;
let lastHandY = null;
let bladeAngle = 0;
const bladeTrail = [];

// --- 1. MEDIAPIPE HANDS KURULUMU ---
const hands = new Hands({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});

hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
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

    // Arka Plan
    drawBackground();

    // Zamanlı Meyve Fırlatma
    if (timestamp - lastSpawnTime > 1100) {
        spawnObject();
        lastSpawnTime = timestamp;
    }

    // Nesneleri Güncelle ve Çiz
    for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        
        obj.x += obj.vx;
        obj.y += obj.vy;
        obj.vy += 0.24; // Yumuşak yerçekimi
        obj.rotation += obj.vRot; // Kendi etrafında dönme

        drawObject(obj);

        if (checkSlice(obj)) {
            objects.splice(i, 1);
            continue;
        }

        if (obj.y > HEIGHT + 100) {
            if (obj.type === 'fruit') {
                lives--;
                updateUI();
                if (lives <= 0) endGame();
            }
            objects.splice(i, 1);
        }
    }

    // Katana ve Bıçak İzini Çiz
    drawKatanaAndTrail();

    requestAnimationFrame(gameLoop);
}

// --- 4. EL ALGILAMA CALLBACK ---
function onResults(results) {
    if (!isMediaPipeReady) {
        isMediaPipeReady = true;
        loadingDiv.classList.add('hidden');
        requestAnimationFrame(gameLoop);
    }

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const handLandmarks = results.multiHandLandmarks[0];
        
        // İşaret parmağı ucu (Landmark 8)
        const rawX = (1 - handLandmarks[8].x) * WIDTH;
        const rawY = handLandmarks[8].y * HEIGHT;

        if (handX === null) {
            handX = rawX;
            handY = rawY;
        } else {
            lastHandX = handX;
            lastHandY = handY;
            handX += (rawX - handX) * 0.5;
            handY += (rawY - handY) * 0.5;

            // Bıçağın Açısını Hesapla
            const dx = handX - lastHandX;
            const dy = handY - lastHandY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                bladeAngle = Math.atan2(dy, dx);
            }
        }

        bladeTrail.push({ x: handX, y: handY });
        if (bladeTrail.length > 14) bladeTrail.shift();
    } else {
        bladeTrail.length = 0;
        handX = null;
        handY = null;
    }
}

// --- 5. YARDIMCI FONKSİYONLAR ---

function spawnObject() {
    // Bomba şansı %7
    const isBomb = Math.random() < 0.07;
    let obj;

    if (isBomb) {
        obj = {
            type: 'bomb',
            x: WIDTH * (0.2 + Math.random() * 0.6),
            y: HEIGHT + 60,
            vx: (Math.random() - 0.5) * 6,
            vy: -(Math.random() * 3 + 15),
            radius: 48,
            rotation: 0,
            vRot: (Math.random() - 0.5) * 0.05
        };
    } else {
        const typeDef = fruitTypes[Math.floor(Math.random() * fruitTypes.length)];
        obj = {
            ...typeDef,
            x: WIDTH * (0.15 + Math.random() * 0.7),
            y: HEIGHT + 60,
            vx: (Math.random() - 0.5) * 7,
            vy: -(Math.random() * 4 + 15),
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

    // Geniş Kesme Alanı
    if (distance < obj.radius + 45) {
        if (obj.type === 'fruit') {
            score += obj.score;
        } else if (obj.type === 'bomb') {
            score = Math.max(0, score - 30);
            lives--;
            if (lives <= 0) endGame();
        }
        updateUI();
        return true;
    }
    return false;
}

function drawBackground() {
    canvasCtx.fillStyle = '#111827';
    canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);

    // Kırmızı Puantiye Desenler
    canvasCtx.fillStyle = 'rgba(230, 57, 70, 0.15)';
    const spacing = 45;
    for (let x = 22; x < WIDTH; x += spacing) {
        for (let y = 22; y < HEIGHT; y += spacing) {
            canvasCtx.beginPath();
            canvasCtx.arc(x, y, 4, 0, Math.PI * 2);
            canvasCtx.fill();
        }
    }

    // Kulüp Filigranı
    canvasCtx.save();
    canvasCtx.font = `bold ${Math.min(WIDTH, HEIGHT) * 0.18}px sans-serif`;
    canvasCtx.textAlign = 'center';
    canvasCtx.textBaseline = 'middle';
    canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    canvasCtx.fillText('<HSD>', WIDTH / 2, HEIGHT / 2);
    canvasCtx.restore();
}

function drawObject(obj) {
    canvasCtx.save();
    canvasCtx.translate(obj.x, obj.y);
    canvasCtx.rotate(obj.rotation);

    if (obj.type === 'bomb') {
        // Yanan Kırmızı Bomba Gövdesi
        canvasCtx.beginPath();
        canvasCtx.arc(0, 0, obj.radius, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#1e293b';
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#ef4444';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();

        // Fitil ve Ateş
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, -obj.radius);
        canvasCtx.quadraticCurveTo(15, -obj.radius - 15, 10, -obj.radius - 25);
        canvasCtx.strokeStyle = '#d97706';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();

        // Kıvılcım/Ateş Efekti
        canvasCtx.beginPath();
        canvasCtx.arc(10, -obj.radius - 25, 8 + Math.random() * 4, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#f59e0b';
        canvasCtx.fill();
    } else {
        // Detaylı Meyve Çizimi
        canvasCtx.beginPath();
        canvasCtx.arc(0, 0, obj.radius, 0, Math.PI * 2);
        canvasCtx.fillStyle = obj.mainColor;
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#ffffff';
        canvasCtx.lineWidth = 3;
        canvasCtx.stroke();

        // İç Katman
        canvasCtx.beginPath();
        canvasCtx.arc(0, 0, obj.radius * 0.75, 0, Math.PI * 2);
        canvasCtx.fillStyle = obj.innerColor;
        canvasCtx.fill();

        // Meyve İkonu
        canvasCtx.font = `${obj.radius * 0.9}px sans-serif`;
        canvasCtx.textAlign = 'center';
        canvasCtx.textBaseline = 'middle';
        canvasCtx.fillText(obj.icon, 0, 0);
    }

    canvasCtx.restore();
}

function drawKatanaAndTrail() {
    if (bladeTrail.length < 2) return;

    // 1. Parlayan Bıçak İzi (Katana Savurma Efekti)
    canvasCtx.save();
    canvasCtx.beginPath();
    canvasCtx.moveTo(bladeTrail[0].x, bladeTrail[0].y);
    for (let i = 1; i < bladeTrail.length; i++) {
        canvasCtx.lineTo(bladeTrail[i].x, bladeTrail[i].y);
    }
    canvasCtx.strokeStyle = '#38bdf8';
    canvasCtx.lineWidth = 14;
    canvasCtx.lineCap = 'round';
    canvasCtx.shadowColor = '#0284c7';
    canvasCtx.shadowBlur = 20;
    canvasCtx.stroke();
    canvasCtx.restore();

    // 2. Katana Kılıcı & El İşaretçisi
    if (handX !== null && handY !== null) {
        canvasCtx.save();
        canvasCtx.translate(handX, handY);
        canvasCtx.rotate(bladeAngle + Math.PI / 4);

        // Katana Kabzası
        canvasCtx.fillStyle = '#000000';
        canvasCtx.fillRect(-6, 10, 12, 35);
        canvasCtx.fillStyle = '#f59e0b';
        canvasCtx.fillRect(-10, 5, 20, 6);

        // Katana Bıçağı
        canvasCtx.beginPath();
        canvasCtx.moveTo(-4, 5);
        canvasCtx.lineTo(-2, -90);
        canvasCtx.lineTo(6, -80);
        canvasCtx.lineTo(4, 5);
        canvasCtx.closePath();
        canvasCtx.fillStyle = '#e2e8f0';
        canvasCtx.shadowColor = '#38bdf8';
        canvasCtx.shadowBlur = 15;
        canvasCtx.fill();

        canvasCtx.restore();
    }
}

function updateUI() {
    scoreValSpan.innerText = score;
    livesValSpan.innerText = lives;
}

function endGame() {
    isGameOver = true;
    finalScoreSpan.innerText = score;
    gameOverDiv.classList.remove('hidden');
}

function resetGame() {
    score = 0;
    lives = 3;
    isGameOver = false;
    objects.length = 0;
    bladeTrail.length = 0;
    gameOverDiv.classList.add('hidden');
    updateUI();
    requestAnimationFrame(gameLoop);
}
