import type { Theme } from "./appearance";

const palettes = {
  Noir: ["239 135 76", "179 111 227", "255 197 148"],
  Astra: ["92 193 223", "164 139 243", "151 227 232"],
  Quartz: ["158 77 43", "103 85 145", "46 109 94"],
} satisfies Record<Theme, readonly [string, string, string]>;

export type SpectralVariant = "project" | "landscape" | "rail";

const nodes = [0.17, 0.37, 0.55, 0.72, 0.85];

function createMesh(strands: number, points: number) {
  const middle = (strands - 1) / 2;
  const stride = points + 1;
  const columns = Array.from({ length: stride }, (_, i) => {
    const q = i / points;
    return {
      q,
      envelope: Math.sin(Math.PI * q),
      warm:
        0.37 +
        0.26 * Math.sin(Math.PI * (q * 0.95 + 0.09)) +
        0.11 * Math.sin(2 * Math.PI * (q * 1.08 - 0.16)),
      cool: 0.69 - 0.37 * Math.exp(-(((q - 0.68) / 0.25) ** 2)),
    };
  });
  const lanes = Array.from({ length: strands }, (_, lane) => ({
    spread: (lane - middle) / middle,
    opacity:
      0.07 + Math.exp(-(((lane - middle) / (middle * (8 / 11.5))) ** 2)) * 0.12,
    firstSine: Math.sin(lane * 0.14),
    firstCosine: Math.cos(lane * 0.14),
    secondSine: Math.sin(lane * 0.1),
    secondCosine: Math.cos(lane * 0.1),
  }));

  return { strands, points, stride, columns, lanes };
}

const heroMesh = createMesh(24, 60);
const railMesh = createMesh(12, 32);

export function createSpectralDrawing(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  variant: SpectralVariant,
) {
  const colors = palettes[theme];
  const landscape = variant === "landscape";
  const rail = variant === "rail";
  const { strands, points, stride, columns, lanes } = rail
    ? railMesh
    : heroMesh;
  const particles = rail ? 12 : 37;
  const paths = new Float32Array(stride * strands);
  // Cache the ridge geometry. Only its scale and the moving carrier change.
  const contours = landscape
    ? [true, false].map((warm) =>
        Float32Array.from({ length: paths.length }, (_, index) => {
          const depth = Math.floor(index / stride) / (strands - 1);
          const q = columns[index % stride]!.q;
          const crest = (warm ? 0.7 : 0.43) + depth * 0.15;
          const ridge = Math.exp(-(((q - crest) / (warm ? 0.17 : 0.21)) ** 2));
          return (
            0.8 -
            0.2 * depth -
            ridge * (0.31 + 0.25 * Math.sin(depth * Math.PI))
          );
        }),
      )
    : undefined;
  let width = 0;
  let height = 0;
  let fades: CanvasGradient[] = [];

  function resize(nextWidth: number, nextHeight: number) {
    width = nextWidth;
    height = nextHeight;
    fades = colors.slice(0, 2).map((color) => {
      const fade = ctx.createLinearGradient(0, 0, width, 0);
      fade.addColorStop(0, `rgb(${color} / 0)`);
      fade.addColorStop(0.13, `rgb(${color} / .65)`);
      fade.addColorStop(0.4, `rgb(${color})`);
      fade.addColorStop(0.86, `rgb(${color} / .84)`);
      fade.addColorStop(1, `rgb(${color} / .06)`);
      return fade;
    });
  }

  function carrierY(q: number, lane: number) {
    const step = q * points;
    const column = Math.floor(step);
    const start = lane * stride + column;
    const a = paths[start]!;
    return a + (paths[start + 1]! - a) * (step - column);
  }

  function trace(lane: number, opacity: number, weight: number) {
    const start = lane * stride;
    ctx.globalAlpha = opacity;
    ctx.lineWidth = weight;
    ctx.beginPath();
    ctx.moveTo(0, paths[start]!);
    for (let i = 1; i <= points; i++) {
      ctx.lineTo((i / points) * width, paths[start + i]!);
    }
    ctx.stroke();
  }

  function draw(
    phase: number,
    pointer: { x: number; y: number; influence: number },
    transition: number,
  ) {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);

    for (let family = 0; family < 2; family++) {
      const color = colors[family];
      const warm = family === 0;

      // Resolve the two shared phases per column, then combine them with the
      // fixed offsets of each lane. The particles read these exact curves.
      for (let i = 0; i <= points; i++) {
        const column = columns[i]!;
        const { q, envelope } = column;
        const bend =
          (pointer.y - 0.5) *
          27 *
          pointer.influence *
          Math.exp(-(((q - pointer.x) / 0.19) ** 2));
        const base = rail
          ? 0.51 +
            (q - 0.5) * (warm ? -0.35 : 0.25) +
            0.21 * Math.sin(q * 5.2 - phase * 0.43 + (warm ? 0 : 2.4))
          : warm
            ? column.warm
            : column.cool - 0.075 * Math.sin(q * 12 + phase * 0.18);
        const rise =
          height * (base + transition * 0.045 * envelope * (warm ? 1 : -1)) +
          bend * (warm ? 1 : 0.65);
        const spread =
          height *
          (rail ? 0.26 : 0.19) *
          (warm
            ? 0.65 + 0.34 * Math.sin(q * 5.2 + phase * 0.06)
            : 0.55 + 0.44 * Math.cos(q * 4.3 + phase * 0.055));
        const firstPhase = q * 12.8 + phase * 0.75;
        const secondPhase = q * 22.1 - phase * 0.37;
        const flutter = envelope * (warm ? 1 : -0.55);
        const firstSine = 5 * Math.sin(firstPhase) * flutter;
        const firstCosine = 5 * Math.cos(firstPhase) * flutter;
        const secondSine = 2.7 * Math.sin(secondPhase) * flutter;
        const secondCosine = 2.7 * Math.cos(secondPhase) * flutter;

        for (let j = 0; j < strands; j++) {
          const lane = lanes[j]!;
          paths[j * stride + i] =
            rise +
            lane.spread * spread +
            firstSine * lane.firstCosine +
            firstCosine * lane.firstSine +
            secondSine * lane.secondCosine +
            secondCosine * lane.secondSine;
        }
      }

      const relief = contours?.[family];
      if (relief) {
        for (let i = 0; i < paths.length; i++) {
          paths[i] = height * relief[i]! + 0.09 * paths[i]!;
        }
      }

      ctx.strokeStyle = fades[family]!;
      for (let lane = 0; lane < strands; lane++) {
        trace(
          lane,
          lanes[lane]!.opacity * (rail ? 2.1 : landscape ? 2.8 : 1),
          landscape ? 0.95 : 0.65,
        );
      }
      const core = Math.round((strands - 1) * (warm ? 0.435 : 0.565));
      if (!rail) trace(core, theme === "Quartz" ? 0.05 : 0.1, 4.8);
      trace(core, rail ? 0.69 : 0.86, rail ? 1.05 : 1.5);

      ctx.fillStyle = `rgb(${color})`;
      for (let i = 0; i < particles; i++) {
        const q =
          (i * 0.1371 +
            phase * ((rail ? 0.022 : 0.003) + (i % 5) * 0.0003) +
            family * 0.43) %
          1;
        ctx.globalAlpha = (i % 9 === 0 ? 0.77 : 0.34) * Math.min(1, q * 5);
        ctx.beginPath();
        ctx.arc(
          q * width,
          carrierY(q, (i * 7 + family * 6) % strands),
          i % 9 === 0 ? 1.4 : 0.65,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      for (let i = family; !rail && i < nodes.length; i += 2) {
        const q = nodes[i]!;
        const x = q * width;
        const y = carrierY(q, core);
        const halo = ctx.createRadialGradient(x, y, 0, x, y, 12);
        halo.addColorStop(0, `rgb(${color} / .46)`);
        halo.addColorStop(1, `rgb(${color} / 0)`);
        ctx.fillStyle = halo;
        ctx.fillRect(x - 12, y - 12, 24, 24);
        ctx.fillStyle = `rgb(${colors[2]})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.75, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return { resize, draw };
}
