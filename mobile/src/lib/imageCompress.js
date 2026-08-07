// Client-side mirror of the backend's receipt resize (RECEIPT_MAX_DIMENSION /
// RECEIPT_JPEG_QUALITY in backend/server.py) - lets the app hold onto a
// storable copy of the photo immediately, before (or without ever) hitting
// POST /receipts/extract, so a receipt captured offline still has an image
// attached once it syncs.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

export function compressImageFile(file, { maxDimension = MAX_DIMENSION, quality = JPEG_QUALITY } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const scale = maxDimension / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Couldn't process image"));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve({ base64: String(reader.result).split(",")[1], contentType: "image/jpeg" });
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read image"));
    };
    img.src = url;
  });
}
