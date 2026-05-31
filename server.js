const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

app.use(express.static('public'));

const odalar = {};

io.on('connection', (socket) => {
  console.log('✅ Bağlantı:', socket.id);

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

    odalar[odaKodu].oyuncular[socket.id] = {
      can: 100,
      hazir: false,
      ad: oyuncuAdi || `Steve_${socket.id.slice(-4)}`
    };

    socket.join(odaKodu);
    socket.emit('odaKoduGonder', odaKodu);
    odaGuncelle(odaKodu);
    console.log(`🏠 Oda oluşturuldu: ${odaKodu}`);
  });

  socket.on('odayaKatil', ({ odaKodu, oyuncuAdi }) => {
    const oda = odalar[odaKodu];
    if (!oda) {
      socket.emit('hata', '❌ Oda bulunamadı');
      return;
    }
    if (oda.oyunBasladi) {
      socket.emit('hata', '❌ Oyun çoktan başlamış');
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

  socket.on('oyunBaslat', (odaKodu) => {
    const oda = odalar[odaKodu];
    if (!oda) return;
    if (oda.kurucuId !== socket.id) {
      socket.emit('hata', '⚠️ Sadece kurucu başlatabilir');
      return;
    }
    const tumuHazir = Object.values(oda.oyuncular).every(p => p.hazir);
    if (!tumuHazir || Object.keys(oda.oyuncular).length < 2) {
      socket.emit('hata', '⚠️ En az 2 oyuncu ve herkes hazır olmalı');
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

  socket.on('hit', (odaKodu) => {
    const oda = odalar[odaKodu];
    if (!oda || !oda.oyunBasladi) return;
    const saldiran = oda.oyuncular[socket.id];
    if (!saldiran || saldiran.can <= 0) return;

    const hedefIdler = Object.keys(oda.oyuncular).filter(id => id !== socket.id && oda.oyuncular[id].can > 0);
    if (hedefIdler.length === 0) return;
    const hedefId = hedefIdler[Math.floor(Math.random() * hedefIdler.length)];
    const hedef = oda.oyuncular[hedefId];
    const hasar = Math.floor(Math.random() * 11) + 10;
    hedef.can = Math.max(0, hedef.can - hasar);

    io.to(odaKodu).emit('hasarBilgi', {
      vuran: saldiran.ad,
      hedef: hedef.ad,
      hasar: hasar,
      hedefYeniCan: hedef.can
    });

    const canlar = {};
    for (let [id, data] of Object.entries(oda.oyuncular)) {
      canlar[id] = data.can;
    }
    io.to(odaKodu).emit('canGuncelle', canlar);

    if (hedef.can <= 0) {
      io.to(odaKodu).emit('oyuncuOldu', { olenAd: hedef.ad });
    }
  });

  socket.on('jump', (odaKodu) => {
    const oda = odalar[odaKodu];
    if (!oda || !oda.oyunBasladi) return;
    const atlayan = oda.oyuncular[socket.id];
    if (atlayan && atlayan.can > 0) {
      io.to(odaKodu).emit('jumpAnim', { ad: atlayan.ad });
    }
  });

  socket.on('disconnect', () => {
    for (let odaKodu in odalar) {
      const oda = odalar[odaKodu];
      if (oda.oyuncular[socket.id]) {
        delete oda.oyuncular[socket.id];
        console.log(`❌ Ayrıldı: ${socket.id} - ${odaKodu}`);
        if (Object.keys(oda.oyuncular).length === 0) {
          delete odalar[odaKodu];
          console.log(`🗑️ Oda silindi: ${odaKodu}`);
        } else {
          if (oda.kurucuId === socket.id) {
            oda.kurucuId = Object.keys(oda.oyuncular)[0];
            io.to(odaKodu).emit('yeniKurucu', oda.kurucuId);
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
    const oyuncular = Object.entries(oda.oyuncular).map(([id, data]) => ({
      id,
      ad: data.ad,
      hazir: data.hazir,
      can: data.can,
      kurucu: id === oda.kurucuId
    }));
    io.to(odaKodu).emit('odaGuncelleme', {
      oyuncular,
      kurucuId: oda.kurucuId,
      oyunBasladi: oda.oyunBasladi
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Sunucu çalışıyor: http://localhost:${PORT}`);
});