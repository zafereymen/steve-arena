const socket = io();
let aktifOdaKodu = null;
let benimId = null;
let oyunAktif = false;
let kurucuBenmi = false;
let oyuncuHaritasi = {}; // id -> {ad, hazir, can, kurucu}

// DOM elemanları
const girisEkrani = document.getElementById('girisEkrani');
const odaEkrani = document.getElementById('odaEkrani');
const odaKoduSpan = document.getElementById('odaKoduSpan');
const oyuncuListesiDiv = document.getElementById('oyuncuListesi');
const hazirBtn = document.getElementById('hazirBtn');
const baslatBtn = document.getElementById('baslatBtn');
const oyunAlani = document.getElementById('oyunAlani');
const hataMesaji = document.getElementById('hataMesaji');
const benAdiSpan = document.getElementById('benAdi');
const benCanBar = document.getElementById('benCan');
const benCanYazi = document.getElementById('benCanYazi');
const savasLog = document.getElementById('savasLogu');
const oyuncuSayisiSpan = document.getElementById('oyuncuSayisi');

// Butonlar
document.getElementById('odaOlusturBtn').onclick = () => {
    const ad = document.getElementById('oyuncuAdi').value.trim() || `Steve_${Math.floor(Math.random()*1000)}`;
    socket.emit('odaOlustur', ad);
};
document.getElementById('odayaKatilBtn').onclick = () => {
    const kod = document.getElementById('odaKoduInput').value.trim();
    const ad = document.getElementById('oyuncuAdi').value.trim() || `Steve_${Math.floor(Math.random()*1000)}`;
    if (!kod) return;
    socket.emit('odayaKatil', { odaKodu: kod, oyuncuAdi: ad });
};
hazirBtn.onclick = () => {
    if (aktifOdaKodu && !oyunAktif) {
        socket.emit('hazirDegistir', aktifOdaKodu);
    }
};
baslatBtn.onclick = () => {
    if (aktifOdaKodu && kurucuBenmi && !oyunAktif) {
        socket.emit('oyunBaslat', aktifOdaKodu);
    }
};
document.getElementById('hitBtn').onclick = () => {
    if (oyunAktif && aktifOdaKodu) {
        socket.emit('hit', aktifOdaKodu);
    }
};
document.getElementById('jumpBtn').onclick = () => {
    if (oyunAktif && aktifOdaKodu) {
        socket.emit('jump', aktifOdaKodu);
    }
};

// Socket olayları
socket.on('odaKoduGonder', (kod) => {
    aktifOdaKodu = kod;
    girisEkrani.style.display = 'none';
    odaEkrani.style.display = 'block';
    odaKoduSpan.innerText = kod;
    oyunAktif = false;
    oyunAlani.style.display = 'none';
    kurucuBenmi = true;
    baslatBtn.disabled = false;
    hataMesaji.innerText = '';
    savasLog.innerHTML = '';
});

socket.on('kurucuOldu', (deger) => {
    kurucuBenmi = deger;
    if (!oyunAktif) baslatBtn.disabled = !deger;
});

socket.on('odaBilgisi', ({ kurucu }) => {
    kurucuBenmi = kurucu;
});

socket.on('odaGuncelleme', ({ oyuncular, kurucuId, oyunBasladi }) => {
    oyuncuHaritasi = {};
    oyuncular.forEach(o => {
        oyuncuHaritasi[o.id] = { ad: o.ad, hazir: o.hazir, can: o.can, kurucu: o.kurucu };
        if (o.id === socket.id) benimId = o.id;
    });
    oyuncuSayisiSpan.innerText = oyuncular.length;
    // oyuncu listesini render et
    let html = '';
    for (let id in oyuncuHaritasi) {
        const p = oyuncuHaritasi[id];
        const hazirText = p.hazir ? '✅ HAZIR' : '❌ HAZIR DEĞİL';
        html += `<div class="oyuncu-karti">
            <span class="oyuncu-adi">${p.ad} ${p.kurucu ? '👑' : ''}</span>
            <span class="${p.hazir ? 'oyuncu-hazir' : 'oyuncu-hazir-degil'}">${hazirText}</span>
        </div>`;
    }
    oyuncuListesiDiv.innerHTML = html;
    
    if (!oyunBasladi) {
        baslatBtn.disabled = !kurucuBenmi;
    } else {
        oyunAlani.style.display = 'block';
        oyunAktif = true;
        baslatBtn.disabled = true;
        hazirBtn.disabled = true;
    }
});

socket.on('hazirDurumu', ({ oyuncular, kurucuId }) => {
    for (let id in oyuncular) {
        if (oyuncuHaritasi[id]) oyuncuHaritasi[id].hazir = oyuncular[id].hazir;
    }
    kurucuBenmi = (kurucuId === socket.id);
    baslatBtn.disabled = !kurucuBenmi;
    // UI güncelleme için tekrar render
    const oyuncularDizisi = Object.keys(oyuncuHaritasi).map(id => ({ id, ...oyuncuHaritasi[id] }));
    document.getElementById('oyuncuListesi').innerHTML = oyuncularDizisi.map(p => `
        <div class="oyuncu-karti">
            <span class="oyuncu-adi">${p.ad} ${p.kurucu ? '👑' : ''}</span>
            <span class="${p.hazir ? 'oyuncu-hazir' : 'oyuncu-hazir-degil'}">${p.hazir ? '✅ HAZIR' : '❌ HAZIR DEĞİL'}</span>
        </div>
    `).join('');
});

socket.on('oyunBasladi', ({ oyuncular }) => {
    oyunAktif = true;
    oyunAlani.style.display = 'block';
    hazirBtn.disabled = true;
    baslatBtn.disabled = true;
    // Benim canımı ayarla
    if (oyuncular[socket.id]) {
        benAdiSpan.innerText = oyuncular[socket.id].ad;
        const can = oyuncular[socket.id].can;
        benCanBar.style.width = can + '%';
        benCanYazi.innerText = can + ' HP';
    }
    savasLog.innerHTML = '<div>🎮 Oyun başladı! Vurmak için KAZMA VUR butonuna bas.</div>';
});

socket.on('canGuncelle', (canlar) => {
    if (canlar[socket.id] !== undefined) {
        const yeniCan = canlar[socket.id];
        benCanBar.style.width = yeniCan + '%';
        benCanYazi.innerText = yeniCan + ' HP';
        if (yeniCan <= 0) {
            oyunAktif = false;
            document.getElementById('hitBtn').disabled = true;
            document.getElementById('jumpBtn').disabled = true;
            savasLog.innerHTML += '<div>💀 SEN ÖLDÜN! Oyun dışı kaldın.</div>';
        }
    }
});

socket.on('hasarBilgi', ({ vuran, hedef, hasar, hedefYeniCan }) => {
    const mesaj = `⚔️ ${vuran} ➜ ${hedef} : ${hasar} hasar (kalan ${hedefYeniCan} HP)`;
    savasLog.innerHTML += `<div>${mesaj}</div>`;
    savasLog.scrollTop = savasLog.scrollHeight;
});

socket.on('oyuncuOldu', ({ olenAd }) => {
    savasLog.innerHTML += `<div>💀 ${olenAd} öldü!</div>`;
});

socket.on('jumpAnim', ({ ad }) => {
    savasLog.innerHTML += `<div>🦘 ${ad} zıpladı!</div>`;
});

socket.on('hata', (msg) => {
    hataMesaji.innerText = msg;
    setTimeout(() => { hataMesaji.innerText = ''; }, 3000);
});

socket.on('yeniKurucu', (yeniKurucuId) => {
    if (yeniKurucuId === socket.id) {
        kurucuBenmi = true;
        if(!oyunAktif) baslatBtn.disabled = false;
        hataMesaji.innerText = '👑 Artık odanın kurucususun!';
    }
});