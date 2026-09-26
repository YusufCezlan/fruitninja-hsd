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

// Nesne Havuzu
const objects = [];
const fruitDefinitions = [
    { name: 'Karpuz', type: 'watermelon', baseScore: 15 },
    { name: 'Muz', type: 'banana', baseScore: 10 },
    { name: 'Çilek', type: 'strawberry', baseScore: 12 },
    { name: 'Portakal', type: 'orange', baseScore: 10 },
    { name: 'Limon', type: 'lemon', baseScore: 10 }
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

    // 1.2 Saniyede Bir Dalga Fırlatma
    if (timestamp - lastSpawnTime > 1200) {
        spawnWave();
        lastSpawnTime = timestamp;
    }

    for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        
        // Fizik Hareketi
        obj.x += obj.vx;
        obj.y += obj.vy;
        obj.vy += obj.gravity;
        obj.rotation += obj.vRot;

        // Meyveyi Özel Şekliyle Çiz
        drawFruitOrBomb(obj);

        // Kesme Kontrolü
        if (checkSlice(obj)) {
            objects.splice(i, 1);
            continue;
        }

        // Ekrandan Düşme / Kaçırma Kontrolü
        if (obj.y > HEIGHT + 160 || obj.x < -200 || obj.x > WIDTH + 200) {
            if (obj.type !== 'bomb') {
                lives--; // KAÇIRILAN HER MEYVE = -1 CAN
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

// --- 5. RASTGELE FIRLATMA, BOYUT VE HIZ MANTIĞI ---

function spawnWave() {
    const count = Math.floor(Math.random() * 3) + 1; // 1 ile 3 arası
    const bombChance = (count === 1) ? 0.12 : 0.02;

    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const isBomb = Math.random() < bombChance;
            spawnObject(isBomb);
        }, i * 150);
    }
}

function spawnObject(isBomb) {
    const side = Math.random();
    let x, y, vx, vy, gravity;

    // Hız Varyasyonu (Hızlı ve Yavaşlar karışık)
    const speedMult = 0.85 + Math.random() * 0.5; // %85 ile %135 arası hız çarpanı

    if (side < 0.4) {
        // Alt taraftan yukarı
        x = WIDTH * (0.2 + Math.random() * 0.6);
        y = HEIGHT + 60;
        vx = (Math.random() - 0.5) * 6 * speedMult;
        vy = -(Math.random() * 4 + 13) * speedMult;
        gravity = 0.20;
    } else if (side < 0.7) {
        // Sol kenardan sağa
        x = -60;
        y = HEIGHT * (0.35 + Math.random() * 0.45);
        vx = (Math.random() * 5 + 8) * speedMult;
        vy = -(Math.random() * 4 + 7) * speedMult;
        gravity = 0.18;
    } else {
        // Sağ kenardan sola
        x = WIDTH + 60;
        y = HEIGHT * (0.35 + Math.random() * 0.45);
        vx = -(Math.random() * 5 + 8) * speedMult;
        vy = -(Math.random() * 4 + 7) * speedMult;
        gravity = 0.18;
    }

    if (isBomb) {
        objects.push({
            type: 'bomb',
            x, y, vx, vy, gravity,
            radius: 50,
            rotation: 0,
            vRot: (Math.random() - 0.5) * 0.05
        });
    } else {
        const typeDef = fruitDefinitions[Math.floor(Math.random() * fruitDefinitions.length)];
        // Boyut Çeşitliliği (Küçük: 0.7, Orta: 1.0, Büyük: 1.3)
        const sizeScale = 0.75 + Math.random() * 0.55; 
        
        objects.push({
            type: typeDef.type,
            name: typeDef.name,
            score: Math.round(typeDef.baseScore * sizeScale),
            radius: 55 * sizeScale,
            scale: sizeScale,
            x, y, vx, vy, gravity,
            rotation: Math.random() * Math.PI,
            vRot: (Math.random() - 0.5) * 0.1
        });
    }
}

function checkSlice(obj) {
    if (handX === null || handY === null) return false;

    const dx = handX - obj.x;
    const dy = handY - obj.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < obj.radius + 120) {
        if (obj.type !== 'bomb') {
            score += obj.score;
        } else {
            score = Math.max(0, score - 5);
            lives -= 5; // BOMBAYA VURUNCA -5 CAN
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

// --- 6. ÖZEL ŞEKİLLİ MEYVE ÇİZİMLERİ ---

function drawFruitOrBomb(obj) {
    canvasCtx.save();
    canvasCtx.translate(obj.x, obj.y);
    canvasCtx.rotate(obj.rotation);
    const r = obj.radius;

    if (obj.type === 'bomb') {
        // Bomba Gövdesi
        canvasCtx.beginPath();
        canvasCtx.arc(0, 0, r, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#1e293b';
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#ef4444';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();

        // Fitil & Ateş
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, -r);
        canvasCtx.quadraticCurveTo(15, -r - 15, 10, -r - 25);
        canvasCtx.strokeStyle = '#d97706';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();

        canvasCtx.beginPath();
        canvasCtx.arc(10, -r - 25, 8 + Math.random() * 4, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#f59e0b';
        canvasCtx.fill();

    } else if (obj.type === 'watermelon') {
        // Karpuz (Yeşil Çizgili Oval Gövde)
        canvasCtx.beginPath();
        canvasCtx.ellipse(0, 0, r * 1.1, r * 0.9, 0, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#27ae60';
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#1e8449';
        canvasCtx.lineWidth = 6;
        canvasCtx.stroke();

        // Koyu Çizgiler
        canvasCtx.strokeStyle = '#145a32';
        canvasCtx.lineWidth = 5;
        for (let i = -1; i <= 1; i++) {
            canvasCtx.beginPath();
            canvasCtx.arc(0, 0, r * 0.8, (i * 0.5) - 0.3, (i * 0.5) + 0.3);
            canvasCtx.stroke();
        }

    } else if (obj.type === 'banana') {
        // Muz (Kıvrımlı Sarı Muz Şekli)
        canvasCtx.beginPath();
        canvasCtx.moveTo(-r * 0.8, -r * 0.4);
        canvasCtx.quadraticCurveTo(0, r * 0.8, r * 0.9, -r * 0.2);
        canvasCtx.quadraticCurveTo(0, r * 0.4, -r * 0.8, -r * 0.4);
        canvasCtx.fillStyle = '#f1c40f';
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#f39c12';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();

        // Uç sap detayları
        canvasCtx.fillStyle = '#7e5109';
        canvasCtx.fillRect(-r * 0.85, -r * 0.45, 8, 8);

    } else if (obj.type === 'strawberry') {
        // Çilek (Kalp/Üçgen Formu)
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, r * 0.9);
        canvasCtx.bezierCurveTo(-r * 1.1, 0, -r * 0.8, -r * 0.8, 0, -r * 0.6);
        canvasCtx.bezierCurveTo(r * 0.8, -r * 0.8, r * 1.1, 0, 0, r * 0.9);
        canvasCtx.fillStyle = '#e74c3c';
        canvasCtx.fill();

        // Benekler
        canvasCtx.fillStyle = '#f9e79f';
        const dots = [[-0.3, -0.1], [0.3, -0.1], [0, 0.3], [-0.2, 0.4], [0.2, 0.4]];
        dots.forEach(([dx, dy]) => {
            canvasCtx.beginPath();
            canvasCtx.arc(dx * r, dy * r, 3, 0, Math.PI * 2);
            canvasCtx.fill();
        });

        // Yeşil Yapraklar
        canvasCtx.fillStyle = '#2ecc71';
        canvasCtx.beginPath();
        canvasCtx.arc(0, -r * 0.6, r * 0.35, 0, Math.PI, true);
        canvasCtx.fill();

    } else if (obj.type === 'orange') {
        // Portakal (Yuvarlak Gözenekli Doku)
        canvasCtx.beginPath();
        canvasCtx.arc(0, 0, r, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#e67e22';
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#d35400';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();

        // İç halka
        canvasCtx.beginPath();
        canvasCtx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#f39c12';
        canvasCtx.fill();

    } else if (obj.type === 'lemon') {
        // Limon (Uçları Çıkıntılı Oval Form)
        canvasCtx.beginPath();
        canvasCtx.ellipse(0, 0, r * 1.1, r * 0.8, 0, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#f1c40f';
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#f39c12';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();

        // Sivri Uçlar
        canvasCtx.beginPath();
        canvasCtx.arc(-r * 1.1, 0, r * 0.15, 0, Math.PI * 2);
        canvasCtx.arc(r * 1.1, 0, r * 0.15, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#f39c12';
        canvasCtx.fill();
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
