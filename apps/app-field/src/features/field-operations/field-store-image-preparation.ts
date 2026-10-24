import { type DshImageUploadInput, resolveJoiningCaseImageContentType } from "@bthwani/dsh";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";
import { fieldJoiningImageDimensionsSupported } from "./field-image-dimensions";
import { publicStoreImageSize } from "./field-store-image-size";

/** Re-encode public store assets; never run this on internal case evidence. */
export async function prepareFieldPublicStoreImage(asset: ImagePickerAsset): Promise<DshImageUploadInput> {
  if (!fieldJoiningImageDimensionsSupported(asset.width, asset.height)) {
    throw new Error("STORE_IMAGE_DIMENSIONS_INVALID");
  }
  if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
    throw new Error("STORE_IMAGE_SIZE_INVALID");
  }
  const contentType = resolveJoiningCaseImageContentType(asset.mimeType, "", asset.fileName, asset.uri);
  if (!contentType) throw new Error("STORE_IMAGE_TYPE_INVALID");

  const context = ImageManipulator.manipulate(asset.uri);
  const resized = publicStoreImageSize(asset.width, asset.height);
  if (resized.width !== asset.width || resized.height !== asset.height) context.resize(resized);
  const rendered = await context.renderAsync();
  const png = contentType === "image/png";
  const output = await rendered.saveAsync({
    format: png ? SaveFormat.PNG : SaveFormat.JPEG,
    compress: png ? 1 : 0.78,
  });
  const response = await fetch(output.uri);
  if (!response.ok) throw new Error("STORE_IMAGE_READ_FAILED");
  const blob = await response.blob();
  if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("STORE_IMAGE_SIZE_INVALID");
  const type = png ? "image/png" : "image/jpeg";
  return {
    uri: output.uri,
    name: png ? "store-image.png" : "store-image.jpg",
    type,
    blob,
  };
}
