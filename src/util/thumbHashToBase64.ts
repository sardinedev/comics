import sharp from "sharp";
import { thumbHashToRGBA } from "thumbhash";

/**
 * Converts a ThumbHash (base64 string) into a data URI for use as a CSS background image.
 * @param thumbHash The base64-encoded ThumbHash string
 * @returns A data URI string like "data:image/png;base64,..." or undefined on error
 */
export async function thumbHashToBase64(thumbHash: string): Promise<string | undefined> {
  try {
    const hashBytes = new Uint8Array(Buffer.from(thumbHash, "base64"));
    const { w, h, rgba } = thumbHashToRGBA(hashBytes);
    const png = await sharp(Buffer.from(rgba), {
      raw: { width: w, height: h, channels: 4 },
    }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch (error) {
    console.error("Error converting thumbHash to base64:", error);
    return undefined;
  }

}
