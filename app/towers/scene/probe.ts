// Capability probe, run once before the Canvas mounts. It opens a throwaway
// WebGL2 context, reads what the browser will say about the GPU, and decides a
// tier. The decision is shown on screen so nobody has to guess why a device
// got the reduced path.
import type { Probe } from "../types";

const MIN_TEXTURE_SIZE = 8192;
const LOW_MEMORY_GB = 4;
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|mesa offscreen|microsoft basic render/i;
const WEAK_MOBILE_GPU = /mali-4|mali-t6|mali-t7|adreno \(tm\) [345]\d\d|powervr sgx|powervr rogue g6/i;

export function runProbe(): Probe {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }) : null;
  const deviceMemoryGb = nav && typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;

  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) as WebGL2RenderingContext | null;
  if (!gl) {
    return {
      webgl2: false,
      renderer: null,
      vendor: null,
      maxTextureSize: null,
      devicePixelRatio: dpr,
      deviceMemoryGb,
      tier: "unsupported",
      dprCap: 1,
      detailEvery: 1,
      reasons: ["WebGL2 is not available in this browser"],
    };
  }

  let renderer: string | null = null;
  let vendor: string | null = null;
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  if (dbg) {
    renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
    vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL));
  } else {
    renderer = String(gl.getParameter(gl.RENDERER));
    vendor = String(gl.getParameter(gl.VENDOR));
  }
  const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || null;

  const reasons: string[] = [];
  if (maxTextureSize !== null && maxTextureSize < MIN_TEXTURE_SIZE) reasons.push(`max texture size ${maxTextureSize}`);
  if (deviceMemoryGb !== null && deviceMemoryGb <= LOW_MEMORY_GB) reasons.push(`device memory ${deviceMemoryGb} GB`);
  if (renderer && SOFTWARE_RENDERER.test(renderer)) reasons.push("software renderer");
  if (renderer && WEAK_MOBILE_GPU.test(renderer)) reasons.push("older mobile GPU");

  gl.getExtension("WEBGL_lose_context")?.loseContext();

  const reduced = reasons.length > 0;
  return {
    webgl2: true,
    renderer,
    vendor,
    maxTextureSize,
    devicePixelRatio: dpr,
    deviceMemoryGb,
    tier: reduced ? "reduced" : "full",
    dprCap: reduced ? 1 : Math.min(dpr, 2),
    detailEvery: reduced ? 4 : 1,
    reasons,
  };
}

export function describeProbe(p: Probe, floorCount: number): string {
  const parts = [
    `WebGL2 ${p.webgl2 ? "yes" : "no"}`,
    p.renderer ? p.renderer : "renderer string withheld",
    p.maxTextureSize !== null ? `max texture ${p.maxTextureSize}` : null,
    `DPR ${p.devicePixelRatio} used ${p.dprCap}`,
    p.deviceMemoryGb !== null ? `memory ${p.deviceMemoryGb} GB` : "memory not reported",
  ].filter(Boolean);
  const detail =
    p.detailEvery === 1
      ? `all ${floorCount} floors at full detail`
      : `detail on ${Math.ceil(floorCount / p.detailEvery)} of ${floorCount} floors`;
  const tier = p.tier === "reduced" ? `reduced (${p.reasons.join(", ")})` : p.tier;
  return `${parts.join(" / ")}. Tier ${tier}: ${detail}.`;
}
