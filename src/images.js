export const ATTACHMENT_IMAGE_LIMIT = 5 * 1024 * 1024;

export function imageMime(image) {
  const data = Buffer.isBuffer(image) ? image : Buffer.from(String(image || "").replace(/^data:[^,]*,/, "").slice(0, 32), "base64");
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString())) return "image/gif";
  if (data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return "";
}

export function attachmentImage(image) {
  if (typeof image !== "string" && !Buffer.isBuffer(image)) return null;
  if (image.length > Math.ceil(ATTACHMENT_IMAGE_LIMIT * 4 / 3) + 128) return null;
  const data = Buffer.isBuffer(image) ? image : Buffer.from(image.replace(/^data:[^,]*,/, ""), "base64");
  const mimeType = imageMime(data);
  return mimeType && data.length <= ATTACHMENT_IMAGE_LIMIT ? { data: data.toString("base64"), mimeType, bytes: data.length } : null;
}
