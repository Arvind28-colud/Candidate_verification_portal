/**
 * High-performance HTML5 Canvas Image Compression Utility.
 * Resizes heavy images to max 640x640 resolution & JPEG 0.75 quality (~50-80KB).
 */
export const compressImageBase64 = (base64Str, maxWidth = 640, maxHeight = 640, quality = 0.75) => {
  return new Promise((resolve) => {
    if (!base64Str || typeof base64Str !== 'string' || base64Str.length < 200) {
      resolve(base64Str || '');
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      } catch (err) {
        console.warn('Canvas image compression notice:', err);
        resolve(base64Str);
      }
    };

    img.onerror = () => {
      resolve(base64Str);
    };

    img.src = base64Str;
  });
};
