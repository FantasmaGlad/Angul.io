import { useEffect, useState } from 'react';

const ASSETS_TO_PRELOAD = [
  '/assets/Banane.png',
  '/assets/BmxPor.png',
  '/assets/Calamard.png',
  '/assets/Champi.png',
  '/assets/KK.png',
  '/assets/Radiateur.png',
  '/assets/Sons/Musiques/Hardcore.m4a',
  '/assets/Sons/Musiques/vanilla.m4a',
];

interface AssetPreloaderProps {
  onComplete: () => void;
}

export default function AssetPreloader({ onComplete }: AssetPreloaderProps) {
  const [progress, setProgress] = useState(0);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    let loadedCount = 0;
    const total = ASSETS_TO_PRELOAD.length;

    const onItemLoaded = () => {
      loadedCount++;
      const pct = Math.min(100, Math.round((loadedCount / total) * 100));
      setProgress(pct);
      if (loadedCount >= total) {
        finish();
      }
    };

    const finish = () => {
      setFadingOut(true);
      setTimeout(() => {
        onComplete();
      }, 400);
    };

    // Preload each asset in parallel
    ASSETS_TO_PRELOAD.forEach((url) => {
      if (url.endsWith('.m4a') || url.endsWith('.mp3')) {
        const audio = new Audio();
        audio.src = url;
        audio.preload = 'auto';
        audio.addEventListener('canplaythrough', onItemLoaded, { once: true });
        audio.addEventListener('error', onItemLoaded, { once: true });
        audio.load();
      } else {
        const img = new Image();
        img.src = url;
        img.onload = onItemLoaded;
        img.onerror = onItemLoaded;
      }
    });

    // Fallback timer (max 3s) so slow networks never block the app
    const fallbackTimer = setTimeout(() => {
      finish();
    }, 3000);

    return () => clearTimeout(fallbackTimer);
  }, [onComplete]);

  return (
    <div className={`asset-preloader-overlay ${fadingOut ? 'fade-out' : ''}`}>
      <div className="asset-preloader-card">
        <div className="asset-preloader-spinner" />
        <h2 className="asset-preloader-title">Téléchargement des assets...</h2>
        <p className="asset-preloader-sub">Préparation des musiques et graphismes pour une expérience optimale</p>
        <div className="asset-preloader-bar-bg">
          <div className="asset-preloader-bar-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="asset-preloader-percent">{progress}%</span>
      </div>
    </div>
  );
}
