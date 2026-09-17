"use client";
// Light and sky, shared by the /towers scene and Walk mode's view out of the
// windows. All of this is a rendering choice, not a reconstruction: no
// photograph, weather record or sun table is cited for it. The brief is a
// working weekday, mid-morning, clear: warm blue overhead, pale at the horizon,
// one sun from the south-east. No shadows and no post-processing (budget rule,
// BUILD-PLAN 3.3); tone mapping is ACES filmic, output sRGB. Paradata P-063.
import { useMemo } from "react";
import { BackSide, Color } from "three";

export const SKY_ZENITH = "#4f86cc";
export const SKY_HORIZON = "#ece5d4";
// The hemisphere light is paler and warmer than the dome's zenith so shaded
// faces stay light and neutral instead of taking a blue cast.
export const HEMI_SKY = "#dfe4ea";
export const HEMI_GROUND = "#efe6d4";
export const SUN_COLOR = "#fff0d2";
export const SUN_INTENSITY = 2.2;
export const HEMI_INTENSITY = 1.6;
export const SKY_RADIUS_M = 12000;
export const GROUND_SIZE_M = 40000;
export const FOG_NEAR_M = 1800;
export const FOG_FAR_M = 9000;

// Gradient sky: a large inverted sphere shaded from the horizon tone at and
// below the eye line to the zenith tone overhead. Written in linear light and
// run through three's tone-mapping and colour-space chunks so it matches the
// lit geometry. Not fogged, not lit, drawn behind everything.
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  varying vec3 vDir;
  void main() {
    float t = clamp(vDir.y, 0.0, 1.0);
    // pale band near the horizon, blue gaining with height
    float k = pow(t, 0.4);
    vec3 c = mix(horizon, zenith, k);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function SkyDome() {
  const uniforms = useMemo(
    () => ({ zenith: { value: new Color(SKY_ZENITH) }, horizon: { value: new Color(SKY_HORIZON) } }),
    [],
  );
  return (
    <mesh renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[SKY_RADIUS_M, 32, 16]} />
      <shaderMaterial vertexShader={SKY_VERT} fragmentShader={SKY_FRAG} uniforms={uniforms} side={BackSide} depthWrite={false} fog={false} toneMapped />
    </mesh>
  );
}
