import { Buffer } from "buffer";
import { FeatureCollection, Geometry } from "geojson";
import Cache from "lru-cache";
import * as parseDbfLib from "parsedbf";
import * as proj4_lib from "proj4";
import { Converter } from "proj4";
import binaryAjax from "./binaryajax";
import { parseShp as parseShpLib } from "./parseShp";
import unzip from "./unzip";

const proj4 = (proj4_lib as any).default;

const cache = new Cache({
  max: 20,
});

function toBuffer(b?: Buffer | ArrayBuffer | Uint8Array): Buffer {
  if (!b) {
    throw new Error("forgot to pass buffer");
  }
  if (Buffer.isBuffer(b)) {
    return b;
  } else if (b instanceof ArrayBuffer) {
    return Buffer.from(b);
  } /*if (b.buffer instanceof ArrayBuffer)*/ else {
    if (b.BYTES_PER_ELEMENT === 1) {
      return Buffer.from(b);
    }
    return Buffer.from(b.buffer);
  }
}

function shp(
  base: string | ArrayBuffer,
  whiteList: string[],
  sourceProjection = "EPSG:4326",
  targetProjection = "EPSG:4326"
): Promise<FeatureCollection | FeatureCollection[]> {
  if (typeof base === "string" && cache.has(base)) {
    return Promise.resolve(cache.get(base));
  }
  return getShapefile(base, sourceProjection, targetProjection, whiteList).then(
    function (resp) {
      if (typeof base === "string") {
        cache.set(base, resp);
      }
      return resp;
    }
  );
}
interface Dbf {
  [x: string]: any;
}
const combine = ([shp, dbf]: [
  shp: Geometry[],
  dbf: Dbf
]): FeatureCollection => {
  const out: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  let i = 0;
  const len = shp.length;
  if (!dbf) {
    dbf = [];
  }
  while (i < len) {
    out.features.push({
      type: "Feature",
      geometry: shp[i],
      properties: dbf[i] || {},
    });
    i++;
  }
  return out;
};
const parseZip = async (
  buffer: ArrayBuffer,
  sourceProjection: string,
  targetProjection: string,
  whiteList?: string[]
): Promise<FeatureCollection | FeatureCollection[]> => {
  let key;
  buffer = toBuffer(buffer);
  const zip: Record<string, string | Buffer | Converter> = await unzip(buffer);
  const names = [];
  whiteList = whiteList || [];
  for (key in zip) {
    if (key.indexOf("__MACOSX") !== -1) {
      continue;
    }
    if (key.slice(-3).toLowerCase() === "shp") {
      names.push(key.slice(0, -4));
      zip[key.slice(0, -3) + key.slice(-3).toLowerCase()] = zip[key];
    } else if (key.slice(-3).toLowerCase() === "prj") {
      zip[key.slice(0, -3) + key.slice(-3).toLowerCase()] = proj4(zip[key]);
    } else if (
      key.slice(-4).toLowerCase() === "json" ||
      whiteList.includes(key.split(".").pop() as string)
    ) {
      names.push(key.slice(0, -3) + key.slice(-3).toLowerCase());
    } else if (
      key.slice(-3).toLowerCase() === "dbf" ||
      key.slice(-3).toLowerCase() === "cpg"
    ) {
      zip[key.slice(0, -3) + key.slice(-3).toLowerCase()] = zip[key];
    }
  }
  if (!names.length) {
    throw new Error("no layers founds");
  }
  const geoJsons: FeatureCollection[] = names.map((name: string) => {
    let parsed: FeatureCollection, dbf;

    const lastDotIdx = name.lastIndexOf(".");
    if (lastDotIdx > -1 && name.slice(lastDotIdx).indexOf("json") > -1) {
      parsed = JSON.parse(zip[name] as string);
    } else {
      if (zip[name + ".dbf"]) {
        dbf = parseDbfLib(zip[name + ".dbf"], zip[name + ".cpg"]);
      }
      let converter: Converter | undefined;
      if (zip[name + ".prj"]) {
        converter = zip[name + ".prj"] as Converter;
        if (sourceProjection === targetProjection) {
          converter = undefined;
        }
      }
      parsed = combine([
        parseShpLib(zip[name + ".shp"] as Buffer, converter),
        dbf,
      ]);
    }
    return parsed;
  });
  if (geoJsons.length === 1) {
    return geoJsons[0];
  } else {
    return geoJsons;
  }
};

async function getZip(
  base: string,
  sourceProjection: string,
  targetProjection: string,
  whiteList?: string[]
): Promise<FeatureCollection | FeatureCollection[]> {
  const a = await binaryAjax(base);
  return parseZip(a as Buffer, sourceProjection, targetProjection, whiteList);
}

const handleShp = async (
  base: string,
  sourceprojection: string,
  targetProjection: string
) => {
  const [buffer, projection] = await Promise.all([
    binaryAjax(base, "shp"),
    binaryAjax(base, "prj"),
  ]);
  let converter: Converter | undefined;
  try {
    if (sourceprojection !== targetProjection && projection) {
      converter = proj4(projection);
    }
  } catch (e) {
    // Failed to reproject
  }
  return parseShpLib(buffer as Buffer, converter);
};

const handleDbf = async (base: string) => {
  const [dbf, cpg] = await Promise.all([
    binaryAjax(base, "dbf"),
    binaryAjax(base, "cpg"),
  ]);
  if (!dbf) {
    return;
  }
  return parseDbfLib(dbf, cpg);
};

const checkSuffix = (base: string, suffix: string): boolean => {
  const url = new URL(base);
  return url.pathname.slice(-4).toLowerCase() === suffix;
};

const getShapefile = async (
  base: string | ArrayBuffer,
  sourceProjection: string,
  targetProjection: string,
  whiteList?: string[]
): Promise<FeatureCollection | FeatureCollection[]> => {
  if (typeof base !== "string") {
    return parseZip(base, sourceProjection, targetProjection);
  }
  if (checkSuffix(base, ".zip")) {
    return getZip(base, sourceProjection, targetProjection, whiteList);
  }
  const results = await Promise.all([
    handleShp(base, sourceProjection, targetProjection),
    handleDbf(base),
  ]);
  return combine(results);
};

const parseShp = (shape: Buffer, prj?: string | ArrayBuffer | boolean) => {
  shape = toBuffer(shape);
  let converter: Converter | undefined;
  if (Buffer.isBuffer(prj)) {
    prj = prj.toString();
  }
  if (typeof prj === "string") {
    try {
      converter = proj4(prj);
    } catch (e) {
      // Converter stays undefined
    }
  }
  return parseShpLib(shape, converter);
};

const parseDbf = (dbf: Buffer, cpg: string) => {
  dbf = toBuffer(dbf);
  return parseDbfLib(dbf, cpg);
};

export { combine, getShapefile, parseShp, parseDbf, shp };
