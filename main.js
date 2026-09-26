// --- KONFİGÜRASYON VE DEĞİŞKENLER ---
const canvasElement = document.getElementById('gameCanvas');
const canvasCtx = canvasElement.getContext('2d');
const videoElement = document.getElementById('input_video');
const loadingDiv = document.getElementById('loading');
const gameOverDiv = document.getElementById('game-over');
const scoreValSpan = document.getElementById('scoreVal');
const livesValSpan = document.getElementById('livesVal');
const finalScoreSpan = document.getElementById('finalScoreVal');

// Dynamic Canvas Resizing
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

// Zaman, Hızlanma ve Çarpan Sistemi
let startTime = 0;
let elapsedTime = 0; // saniye
let scoreMultiplier = 1;
let globalSpeedMultiplier = 1;

// Meyve Tanımları
const objects = [];
const fruitDefinitions = [
    { name: 'Karpuz Dilimi', type: 'watermelon_slice', baseScore: 15 },
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

    if (!startTime) startTime = timestamp;
    elapsedTime = Math.floor((timestamp - startTime) / 1000);

    // Zamanla Hızlanma ve Çarpan Artışı
    // Her 15 saniyede bir çarpan ve hız artar
    scoreMultiplier = 1 + Math.floor(elapsedTime / 15) * 0.5; // 1x, 1.5x, 2x...
    globalSpeedMultiplier = 1 + (elapsedTime / 45); // Yavaşça hızlanır

    drawBackground();

    // Dinamik Fırlatma Aralığı (Zamanla sıklaşır)
    const spawnInterval = Math.max(700, 1300 - (elapsedTime * 8));
    if (timestamp - lastSpawnTime > spawnInterval) {
        spawnWave();
        lastSpawnTime = timestamp;
    }

    for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        
        obj.x += obj.vx;
        obj.y += obj.vy;
        obj.vy += obj.gravity;
        obj.rotation += obj.vRot;

        drawFruitOrBomb(obj);

        if (checkSlice(obj)) {
            objects.splice(i, 1);
            continue;
        }

        // Kaçırma Kontrolü
        if (obj.y > HEIGHT + 160 || obj.x < -200 || obj.x > WIDTH + 200) {
            if (obj.type !== 'bomb') {
                lives--;
                updateUI();
                if (lives <= 0) endGame();
            }
            objects.splice(i, 1);
        }
    }

    drawKatanaAndHand();
    drawTopUI();

    requestAnimationFrame(gameLoop);
}

// --- 4. EL ALGILAMA ---
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

// --- 5. RASTGELE FIRLATMA MANTIĞI ---

function spawnWave() {
    const count = Math.floor(Math.random() * 3) + 1;
    const bombChance = (count === 1) ? 0.12 : 0.02;

    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const isBomb = Math.random() < bombChance;
            spawnObject(isBomb);
        }, i * 140);
    }
}

function spawnObject(isBomb) {
    const side = Math.random();
    let x, y, vx, vy, gravity;

    const currentSpeed = (0.9 + Math.random() * 0.4) * globalSpeedMultiplier;

    if (side < 0.4) {
        x = WIDTH * (0.2 + Math.random() * 0.6);
        y = HEIGHT + 60;
        vx = (Math.random() - 0.5) * 6 * currentSpeed;
        vy = -(Math.random() * 4 + 13) * currentSpeed;
        gravity = 0.20;
    } else if (side < 0.7) {
        x = -60;
        y = HEIGHT * (0.35 + Math.random() * 0.45);
        vx = (Math.random() * 5 + 8) * currentSpeed;
        vy = -(Math.random() * 4 + 7) * currentSpeed;
        gravity = 0.18;
    } else {
        x = WIDTH + 60;
        y = HEIGHT * (0.35 + Math.random() * 0.45);
        vx = -(Math.random() * 5 + 8) * currentSpeed;
        vy = -(Math.random() * 4 + 7) * currentSpeed;
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
        const sizeScale = 0.8 + Math.random() * 0.4; 
        
        objects.push({
            type: typeDef.type,
            name: typeDef.name,
            baseScore: typeDef.baseScore,
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

    if (distance < obj.radius + 115) {
        if (obj.type !== 'bomb') {
            // Çarpanlı Puan Kazanımı
            const pointsGained = Math.round(obj.baseScore * scoreMultiplier);
            score += pointsGained;
        } else {
            score = Math.max(0, score - 5);
            lives -= 5;
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

// --- 6. GERÇEKÇİ MEYVE VE BİREBİR KARPUZ DİLİMİ ÇİZİMİ ---

function drawFruitOrBomb(obj) {
    canvasCtx.save();
    canvasCtx.translate(obj.x, obj.y);
    canvasCtx.rotate(obj.rotation);
    const r = obj.radius;

    if (obj.type === 'bomb') {
        canvasCtx.beginPath();
        canvasCtx.arc(0, 0, r, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#1e293b';
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#ef4444';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();

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

    } else if (obj.type === 'watermelon_slice') {
        // BİREBİR KARPUZ DİLİMİ (Üçgen Form, Kabuk ve Çekirdekler)
        canvasCtx.beginPath();
        canvasCtx.moveTo(-r, -r * 0.5);
        canvasCtx.lineTo(r, -r * 0.5);
        canvasCtx.quadraticCurveTo(0, r * 1.2, -r, -r * 0.5);
        canvasCtx.closePath();

        // Kırmızı Meyve Eti
        canvasCtx.fillStyle = '#e74c3c';
        canvasCtx.fill();

        // Yeşil Dış Kabuk
        canvasCtx.strokeStyle = '#27ae60';
        canvasCtx.lineWidth = 8;
        canvasCtx.stroke();

        // Beyaz/Açık Yeşil İç Kabuk Şeridi
        canvasCtx.strokeStyle = '#2ecc71';
        canvasCtx.lineWidth = 3;
        canvasCtx.stroke();

        // Siyah Çekirdekler
        canvasCtx.fillStyle = '#1c2833';
        const seeds = [[-r*0.4, -r*0.1], [0, r*0.3], [r*0.4, -r*0.1], [-r*0.2, r*0.1], [r*0.2, r*0.1]];
        seeds.forEach(([sx, sy]) => {
            canvasCtx.beginPath();
            canvasCtx.arc(sx, sy, 3.5, 0, Math.PI * 2);
            canvasCtx.fill();
        });

    } else if (obj.type === 'banana') {
        canvasCtx.beginPath();
        canvasCtx.moveTo(-r * 0.8, -r * 0.4);
        canvasCtx.quadraticCurveTo(0, r * 0.8, r * 0.9, -r * 0.2);
        canvasCtx.quadraticCurveTo(0, r * 0.4, -r * 0.8, -r * 0.4);
        canvasCtx.fillStyle = '#f1c40f';
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#f39c12';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();

        canvasCtx.fillStyle = '#7e5109';
        canvasCtx.fillRect(-r * 0.85, -r * 0.45, 8, 8);

    } else if (obj.type === 'strawberry') {
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, r * 0.9);
        canvasCtx.bezierCurveTo(-r * 1.1, 0, -r * 0.8, -r * 0.8, 0, -r * 0.6);
        canvasCtx.bezierCurveTo(r * 0.8, -r * 0.8, r * 1.1, 0, 0, r * 0.9);
        canvasCtx.fillStyle = '#e74c3c';
        canvasCtx.fill();

        canvasCtx.fillStyle = '#f9e79f';
        const dots = [[-0.3, -0.1], [0.3, -0.1], [0, 0.3], [-0.2, 0.4], [0.2, 0.4]];
        dots.forEach(([dx, dy]) => {
            canvasCtx.beginPath();
            canvasCtx.arc(dx * r, dy * r, 3, 0, Math.PI * 2);
            canvasCtx.fill();
        });

        canvasCtx.fillStyle = '#2ecc71';
        canvasCtx.beginPath();
        canvasCtx.arc(0, -r * 0.6, r * 0.35, 0, Math.PI, true);
        canvasCtx.fill();

    } else if (obj.type === 'orange') {
        canvasCtx.beginPath();
        canvasCtx.arc(0, 0, r, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#e67e22';
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#d35400';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();

        canvasCtx.beginPath();
        canvasCtx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#f39c12';
        canvasCtx.fill();

    } else if (obj.type === 'lemon') {
        canvasCtx.beginPath();
        canvasCtx.ellipse(0, 0, r * 1.1, r * 0.8, 0, 0, Math.PI * 2);
        canvasCtx.fillStyle = '#f1c40f';
        canvasCtx.fill();
        canvasCtx.strokeStyle = '#f39c12';
        canvasCtx.lineWidth = 4;
        canvasCtx.stroke();
    }

    canvasCtx.restore();
}

// --- 7. %85 ORANINDA KÜÇÜLTÜLMÜŞ KATANA ÇİZİMİ ---

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
        canvasCtx.lineWidth = 24; // %85 Çap
        canvasCtx.lineCap = 'round';
        canvasCtx.shadowColor = isFistClosed ? '#f59e0b' : '#0284c7';
        canvasCtx.shadowBlur = 30;
        canvasCtx.stroke();
        canvasCtx.restore();
    }

    canvasCtx.save();
    canvasCtx.translate(handX, handY);
    canvasCtx.rotate(bladeAngle + Math.PI / 4);

    // Katana Kabzası
    canvasCtx.fillStyle = '#000000';
    canvasCtx.fillRect(-10, 15, 20, 50);
    canvasCtx.fillStyle = '#f59e0b';
    canvasCtx.fillRect(-18, 8, 36, 10);

    // %85 Oranında Küçültülmüş Katana Bıçağı (204px)
    canvasCtx.beginPath();
    canvasCtx.moveTo(-8, 8);
    canvasCtx.lineTo(-3, -204);
    canvasCtx.lineTo(10, -187);
    canvasCtx.lineTo(8, 8);
    canvasCtx.closePath();

    canvasCtx.fillStyle = isFistClosed ? '#ffffff' : 'rgba(255, 255, 255, 0.85)';
    canvasCtx.shadowColor = isFistClosed ? '#ef4444' : '#38bdf8';
    canvasCtx.shadowBlur = 25;
    canvasCtx.fill();

    // El İkonu
    canvasCtx.font = '36px sans-serif';
    canvasCtx.textAlign = 'center';
    canvasCtx.textBaseline = 'middle';
    canvasCtx.fillText(isFistClosed ? '✊' : '🖐️', 0, 90);

    canvasCtx.restore();
}

// --- 8. ZAMAN VE ÇARPAN BİLGİ SEKMESİ (ÜST EKRAN) ---

function drawTopUI() {
    canvasCtx.save();
    canvasCtx.font = 'bold 26px sans-serif';
    canvasCtx.fillStyle = '#f1c40f';
    canvasCtx.textAlign = 'center';
    
    // Dakika:Saniye Formatı
    const mins = Math.floor(elapsedTime / 60).toString().padStart(2, '0');
    const secs = (elapsedTime % 60).toString().padStart(2, '0');
    
    canvasCtx.fillText(`⏱️ SÜRE: ${mins}:${secs}   |   🔥 ÇARPAN: ${scoreMultiplier}x`, WIDTH / 2, 45);
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
    startTime = 0;
    elapsedTime = 0;
    scoreMultiplier = 1;
    globalSpeedMultiplier = 1;
    isGameOver = false;
    objects.length = 0;
    bladeTrail.length = 0;
    gameOverDiv.classList.add('hidden');
    updateUI();
    requestAnimationFrame(gameLoop);
}
