export function setPaymentProofPreviewDom(dataUrl) {
  const preview = document.querySelector("#payment-proof-preview");
  const uploadArea = document.querySelector("#proof-upload-area");
  const image = preview?.querySelector("img");
  if (!preview || !image) return;
  image.src = dataUrl;
  uploadArea?.classList.add("has-image");
}

export function clearPaymentProofImageDom() {
  const fileInput = document.querySelector("#payment-proof-file");
  const preview = document.querySelector("#payment-proof-preview");
  const uploadArea = document.querySelector("#proof-upload-area");
  const image = preview?.querySelector("img");
  if (fileInput) fileInput.value = "";
  if (image) image.removeAttribute("src");
  uploadArea?.classList.remove("has-image", "drag-over");
}

export function setPaymentProofProgress(value, visible = true) {
  const progress = document.querySelector("#payment-proof-progress");
  const bar = progress?.querySelector("progress");
  const label = progress?.querySelector("b");
  const percent = Math.max(0, Math.min(100, Math.round(Number(value || 0))));
  if (!progress || !bar || !label) return;
  progress.classList.toggle("hidden", !visible);
  bar.value = percent;
  label.textContent = `${percent}%`;
}

export function setPaymentProofReadonly(readonly) {
  const form = document.querySelector("#payment-proof-form");
  const uploadArea = document.querySelector("#proof-upload-area");
  if (!form) return;
  form.classList.toggle("readonly", readonly);
  uploadArea?.classList.toggle("readonly", readonly);
  form.elements.actualAmount.readOnly = readonly;
  form.elements.paymentDate.readOnly = readonly;
}

export function readProofFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("請上傳圖片格式的支付憑證。"));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error("支付憑證圖片大小需小於 8MB。"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("讀取圖片失敗，請重新選擇。"));
    reader.readAsDataURL(file);
  });
}
