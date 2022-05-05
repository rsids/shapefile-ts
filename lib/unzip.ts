import { Buffer } from "buffer";
import jszip from "jszip";

const unzip = async (buffer: ArrayBuffer) => {
  const zip = new jszip();
  await zip.loadAsync(buffer);
  const files = zip.file(/.+/);
  const out: Record<string, string | Buffer> = {};
  await Promise.all(
    files.map(async (a) => {
      let result: string | Buffer;
      if (
        a.name.slice(-3).toLowerCase() === "shp" ||
        a.name.slice(-3).toLowerCase() === "dbf"
      ) {
        result = Buffer.from(await a.async("arraybuffer"));
      } else {
        result = await a.async("text");
      }
      out[a.name] = result;
    })
  );
  return out;
};

export default unzip;
