'use client';

import { useEffect } from 'react';

export function PWAInstaller() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        // Handle updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              // The new service worker takes over on the next navigation.
            }
          });
        });
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[Melodia] Service Worker registration failed:', error);
        }
      }
    };

    // Register service worker after a short delay to ensure app is loaded
    const timeout = setTimeout(registerServiceWorker, 1000);
    return () => clearTimeout(timeout);
  }, []);

  return null;
}
