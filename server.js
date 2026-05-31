const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// Aktif odalar: { odaKodu: { kurucuId, oyuncular: { socketId: { can, hazir, ad } }, oyunBasladi } }
const odalar = {};

io.on('connection', (socket) => {
    console.log(`✅ Steve bağlandı: ${socket.id}`);

    // Oda oluştur
    socket.on('odaOlustur', (oyuncuAdi) => {
        let odaKodu;
        do {
            odaKodu = Math.floor(10000 + Math.random() * 90000).toString();
        } while (odalar[odaKodu]);

        odalar[odaKodu] = {
            kurucuId: socket.id,
            oyuncular: {},
            oyunBasladi: false
        };

        // Kurucuyu ekle
        odalar[odaKodu].oyuncular[socket.id] = {
            can: 100,
            hazir: false,
            ad: oyuncuAdi || `Steve_${socket.id.slice(-4)}`
        };

        socket.join(odaKodu);
        socket.emit('odaKoduGonder', odaKodu);
        socket.emit('kurucuOldu', true);
        
        // Odadaki herkese oyuncu listesini gönder
        odaGuncelle(odaKodu);
        console.log(`🏠 Oda oluşturuldu: ${odaKodu}, kurucu: ${socket.id}`);
    });

    // Odaya katıl
    socket.on('odayaKatil', ({ odaKodu, oyuncuAdi }) => {
        const oda = odalar[odaKodu];
        if (!oda) {
            socket.emit('hata', '❌ Oda bulunamadı!');
            return;
        }
        if (oda.oyunBasladi) {
            socket.emit('hata', '❌ Oyun çoktan başladı, katılamazsın.');
            return;
        }
        if (Object.keys(oda.oyuncular).length >= 4) {
            socket.emit('hata', '❌ Oda dolu (4/4)');
            return;
        }

        oda.oyuncular[socket.id] = {
            can: 100,
            hazir: false,
            ad: oyuncuAdi || `Steve_${socket.id.slice(-4)}`
        };
        socket.join(odaKodu);
        socket.emit('odaBilgisi', { odaKodu, kurucu: oda.kurucuId === socket.id });
        odaGuncelle(odaKodu);
        console.log(`🚪 Katılım: ${socket.id} -> ${odaKodu}`);
    });

    // Hazır ol / hazır değil
    socket.on('hazirDegistir', (odaKodu) => {
        const oda = odalar[odaKodu];
        if (oda && oda.oyuncular[socket.id]) {
            oda.oyuncular[socket.id].hazir = !oda.oyuncular[socket.id].hazir;
            io.to(odaKodu).emit('hazirDurumu', {
                oyuncular: Object.fromEntries(
                    Object.entries(oda.oyuncular).map(([id, data]) => [id, { hazir: data.hazir, ad: data.ad }])
                ),
                kurucuId: oda.kurucuId
            });
        }
    });

    // Oyunu başlat (sadece kurucu)
    socket.on('oyunBaslat', (odaKodu) => {
        const oda = odalar[odaKodu];
        if (!oda) return;
        if (oda.kurucuId !== socket.id) {
            socket.emit('hata', '⚠️ Sadece oda kurucusu oyunu başlatabilir.');
            return;
        }
        // Tüm oyuncular hazır mı?
        const tumuHazir = Object.values(oda.oyuncular).every(p => p.hazir === true);
        if (!tumuHazir) {
            socket.emit('hata', '⚠️ Tüm oyuncular hazır olmadan başlatılamaz.');
            return;
        }
        if (Object.keys(oda.oyuncular).length < 2) {
            socket.emit('hata', '⚠️ En az 2 oyuncu gerekli.');
            return;
        }
        oda.oyunBasladi = true;
        io.to(odaKodu).emit('oyunBasladi', {
            oyuncular: Object.fromEntries(
                Object.entries(oda.oyuncular).map(([id, data]) => [id, { can: data.can, ad: data.ad }])
            )
        });
        console.log(`🎮 Oyun başladı: ${odaKodu}`);
    });

    // HIT (saldırı) – rastgele başka bir oyuncuya hasar ver
    socket.on('hit', (odaKodu) => {
        const oda = odalar[odaKodu];
        if (!oda || !oda.oyunBasladi) return;
        const saldiran = oda.oyuncular[socket.id];
        if (!saldiran || saldiran.can <= 0) return; // ölü oyuncu vuramaz

        // Hedef: başka bir oyuncu (kendisi hariç)
        const digerOyuncular = Object.keys(oda.oyuncular).filter(id => id !== socket.id && oda.oyuncular[id].can > 0);
        if (digerOyuncular.length === 0) return;
        const hedefId = digerOyuncular[Math.floor(Math.random() * digerOyuncular.length)];
        const hedef = oda.oyuncular[hedefId];
        const hasar = Math.floor(Math.random() * 11) + 10; // 10-20 arası
        hedef.can = Math.max(0, hedef.can - hasar);
        
        // Hasar mesajı
        io.to(odaKodu).emit('hasarBilgi', {
            vuran: saldiran.ad,
            hedef: hedef.ad,
            hasar: hasar,
            hedefYeniCan: hedef.can
        });
        
        // Güncel canları herkese gönder
        const canlar = {};
        for (let [id, data] of Object.entries(oda.oyuncular)) {
            canlar[id] = data.can;
        }
        io.to(odaKodu).emit('canGuncelle', canlar);
        
        // Bir oyuncu öldü mü kontrol et
        if (hedef.can <= 0) {
            io.to(odaKodu).emit('oyuncuOldu', { olenId: hedefId, olenAd: hedef.ad });
        }
    });

    // JUMP (sadece mesaj at, mekanik yok)
    socket.on('jump', (odaKodu) => {
        const oda = odalar[odaKodu];
        if (!oda || !oda.oyunBasladi) return;
        const atlayan = oda.oyuncular[socket.id];
        if (atlayan && atlayan.can > 0) {
            io.to(odaKodu).emit('jumpAnim', { ad: atlayan.ad });
        }
    });

    // Bağlantı kopunca oyuncuyu odadan temizle
    socket.on('disconnect', () => {
        for (let odaKodu in odalar) {
            const oda = odalar[odaKodu];
            if (oda.oyuncular[socket.id]) {
                delete oda.oyuncular[socket.id];
                console.log(`❌ Ayrıldı: ${socket.id} - ${odaKodu}`);
                if (Object.keys(oda.oyuncular).length === 0) {
                    delete odalar[odaKodu];
                    console.log(`🗑️ Oda silindi (boş): ${odaKodu}`);
                } else {
                    // Yeni kurucu belirle (eğer kalan varsa)
                    if (oda.kurucuId === socket.id) {
                        const yeniKurucu = Object.keys(oda.oyuncular)[0];
                        oda.kurucuId = yeniKurucu;
                        io.to(odaKodu).emit('yeniKurucu', yeniKurucu);
                    }
                    odaGuncelle(odaKodu);
                }
                break;
            }
        }
    });

    function odaGuncelle(odaKodu) {
        const oda = odalar[odaKodu];
        if (!oda) return;
        const oyuncuListesi = Object.entries(oda.oyuncular).map(([id, data]) => ({
            id,
            ad: data.ad,
            hazir: data.hazir,
            can: data.can,
            kurucu: id === oda.kurucuId
        }));
        io.to(odaKodu).emit('odaGuncelleme', {
            oyuncular: oyuncuListesi,
            kurucuId: oda.kurucuId,
            oyunBasladi: oda.oyunBasladi
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Sunucu çalışıyor: http://localhost:${PORT}`);
});