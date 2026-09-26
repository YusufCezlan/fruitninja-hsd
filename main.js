// --- KONFİGÜRASYON VE DEĞİŞKENLER ---
const canvasElement = document.getElementById('gameCanvas');
const canvasCtx = canvasElement.getContext('2d');
const videoElement = document.getElementById('input_video');
const loadingDiv = document.getElementById('loading');
const gameOverDiv = document.getElementById('game-over');
const scoreValSpan = document.getElementById('scoreVal');
const livesValSpan = document.getElementById('livesVal');
const finalScoreSpan = document.getElementById('finalScoreVal');

// Oyun Boyutları
const WIDTH = canvasElement.width;
const HEIGHT = canvasElement.height;

// Oyun Durumu
let score = 0;
let lives = 3;
let isGameOver = false;
let isMediaPipeReady = false;

// Meyve ve Fizik Parametreleri
const objects = [];
const objectTypes = [
    { type: 'fruit', color: '#f1c40f', score: 10, radius: 25 }, // Limon
    { type: 'fruit', color: '#e67e22', score: 10, radius: 28 }, // Portakal
    { type: 'fruit', color: '#e74c3c', score: 10, radius: 30 }, // Karpuz
    { type: 'bomb', color: '#2c3e50', score: -50, radius: 20 }  // Bomba
];

// El Takibi Değişkenleri
let lastHandX = null;
let lastHandY = null;
const bladeTrail = []; // Bıçağın izini tutar

// --- 1. MEDIAPIPE HANDS KURULUMU ---
const hands = new Hands({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});

hands.setOptions({
    maxNumHands: 1, // Stantta karmaşayı önlemek için tek el
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});

// El verileri her güncellendiğinde çalışır
hands.onResults(onResults);

// --- 2. KAMERA KURULUMU ---
const camera = new Camera(videoElement, {
    onFrame: async () => {
        await hands.send({image: videoElement});
    },
    width: WIDTH,
    height: HEIGHT
});

// Oyunu Başlat
camera.start().then(() => {
    console.log("Kamera başlatıldı.");
});


// --- 3. OYUN DÖNGÜSÜ (CORE LOGIC) ---
function gameLoop() {
    if (isGameOver || !isMediaPipeReady) return;

    // 1. Canvas'ı Temizle
    canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

    // 2. Arka Planı Çiz
    drawBackground();

    // 3. Meyve Oluştur (Rastgele zamanlarda)
    if (Math.random() < 0.03) { // %3 şans
        spawnObject();
    }

    // 4. Nesneleri Güncelle ve Çiz
    for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i];
        
        // Fizik Güncellemesi
        obj.x += obj.vx;
        obj.y += obj.vy;
        obj.vy += 0.15; // Yerçekimi

        // Nesneyi Çiz
        drawObject(obj);

        // Bıçakla Çarpışma Kontrolü (Kesme)
        if (checkSlice(obj)) {
            objects.splice(i, 1);
            continue;
        }

        // Ekrandan Çıktı mı?
        if (obj.y > HEIGHT + 50) {
            if (obj.type === 'fruit') {
                lives--; // Karpuzu kaçırdın!
                updateUI();
                if (lives <= 0) endGame();
            }
            objects.splice(i, 1);
        }
    }

    // 5. Bıçak İzini Çiz
    drawBladeTrail();

    // Döngüyü tekrarla
    requestAnimationFrame(gameLoop);
}

// --- 4. EL ALGILAMA SONUÇLARI (MEDIAPIPE CALLBACK) ---
function onResults(results) {
    if (!isMediaPipeReady) {
        isMediaPipeReady = true;
        loadingDiv.classList.add('hidden');
        gameLoop(); // İlk el algılandığında döngüyü başlat
    }

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const handLandmarks = results.multiHandLandmarks[0];
        
        // İşaret parmağı ucunu (Index Finger Tip) bıçak ucu olarak kullan
        // MediaPipe koordinatları (0-1) arasındadır, canvas boyutuna çevir
        const currentHandX = (1 - handLandmarks[8].x) * WIDTH; // Yatayda aynala
        const currentHandY = handLandmarks[8].y * HEIGHT;

        // Bıçak izine ekle
        bladeTrail.push({ x: currentHandX, y: currentHandY });
        if (bladeTrail.length > 10) bladeTrail.shift(); // İzi kısa tut

        lastHandX = currentHandX;
        lastHandY = currentHandY;
    } else {
        // El yoksa izi temizle
        bladeTrail.length = 0;
        lastHandX = null;
        lastHandY = null;
    }
}

// --- 5. YARDIMCI FONKSİYONLAR ---

function spawnObject() {
    const typeDef = objectTypes[Math.floor(Math.random() * objectTypes.length)];
    const obj = {
        ...typeDef,
        x: WIDTH * (0.2 + Math.random() * 0.6), // Ortadan fırlat
        y: HEIGHT + 20,
        vx: (Math.random() - 0.5) * 4, // Hafif sağa/sola
        vy: -(Math.random() * 5 + 10) // Yukarı fırlatma hızı
    };
    objects.push(obj);
}

function checkSlice(obj) {
    if (lastHandX === null || lastHandY === null) return false;

    // Bıçak ucu ile nesne merkezi arasındaki mesafe
    const dx = lastHandX - obj.x;
    const dy = lastHandY - obj.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Çarpışma var mı?
    if (distance < obj.radius + 10) { // +10 bıçak genişliği hissi için
        if (obj.type === 'fruit') {
            score += obj.score;
        } else if (obj.type === 'bomb') {
            score += obj.score; // Bomba puan düşürür
            endGame(); // Veya direkt oyun biter
        }
        updateUI();
        return true; // Kesildi
    }
    return false;
}

function drawBackground() {
    // Canvas arka planı style.css'den geliyor, buraya kulüp logosu eklenebilir.
    canvasCtx.fillStyle = "rgba(44, 62, 80, 0.5)";
    canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawObject(obj) {
    canvasCtx.beginPath();
    canvasCtx.arc(obj.x, obj.y, obj.radius, 0, Math.PI * 2);
    canvasCtx.fillStyle = obj.color;
    canvasCtx.fill();
    canvasCtx.strokeStyle = "white";
    canvasCtx.lineWidth = 2;
    canvasCtx.stroke();
    canvasCtx.closePath();

    // Bomba efekti
    if (obj.type === 'bomb') {
        canvasCtx.fillStyle = 'white';
        canvasCtx.font = "16px Arial";
        canvasCtx.fillText("BOMB", obj.x - 20, obj.y + 5);
    }
}

function drawBladeTrail() {
    if (bladeTrail.length < 2) return;

    canvasCtx.beginPath();
    canvasCtx.moveTo(bladeTrail[0].x, bladeTrail[0].y);
    
    for (let i = 1; i < bladeTrail.length; i++) {
        canvasCtx.lineTo(bladeTrail[i].x, bladeTrail[i].y);
    }

    canvasCtx.strokeStyle = 'rgba(236, 240, 241, 0.8)'; // Bıçak izi rengi
    canvasCtx.lineWidth = 8;
    canvasCtx.lineCap = 'round';
    canvasCtx.stroke();
    canvasCtx.closePath();
}

function updateUI() {
    scoreValSpan.innerText = score;
    livesValSpan.innerText = lives;
}

function endGame() {
    isGameOver = true;
    camera.stop();
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
    camera.start();
    gameLoop();
}