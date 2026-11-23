import { useEffect, useRef, type RefObject } from "react";
import type { Theme } from "./appearance";
import { createSpectralDrawing } from "./spectralDrawing";
import { LambdaMark } from "./VisualIcon";

export function SpectralField({
  theme,
  paused,
  phase,
  scene,
}: {
  theme: Theme;
  paused: boolean;
  phase: RefObject<number>;
  scene: string;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const transition = useRef(0);

  useEffect(() => {
    transition.current = 1;
  }, [scene]);

  useEffect(() => {
    const area = surface.current;
    const target = canvas.current;
    const ctx = target?.getContext("2d");
    if (!area || !target || !ctx) return;

    const drawing = createSpectralDrawing(ctx, theme);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { x: 0.5, y: 0.5, influence: 0 };
    let targetX = 0.5;
    let targetY = 0.5;
    let hovered = false;
    let inView = false;
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastTime = 0;
    const readResolution = () =>
      window.matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    let resolution = readResolution();

    function animate(time: number) {
      const elapsed = lastTime ? Math.min(time - lastTime, 50) : 0;
      lastTime = time;
      phase.current += elapsed * 0.00078;
      const smoothing = 1 - Math.exp(-elapsed / 110);
      pointer.x += (targetX - pointer.x) * smoothing;
      pointer.y += (targetY - pointer.y) * smoothing;
      pointer.influence += ((hovered ? 1 : 0) - pointer.influence) * smoothing;
      transition.current *= Math.exp(-elapsed / 160);
      drawing.draw(phase.current, pointer, transition.current);
      frame = requestAnimationFrame(animate);
    }

    function syncMotion() {
      cancelAnimationFrame(frame);
      lastTime = 0;
      if (inView && !document.hidden && !paused && !reduced.matches) {
        frame = requestAnimationFrame(animate);
      } else {
        hovered = false;
        pointer.influence = 0;
        transition.current = 0;
        drawing.draw(phase.current, pointer, 0);
      }
    }

    const resize = () => {
      const { width: w, height: h } = area.getBoundingClientRect();
      if (!w || !h) return;
      const scale = Math.min(devicePixelRatio || 1, 1.75);
      const pixelWidth = Math.max(1, Math.round(w * scale));
      const pixelHeight = Math.max(1, Math.round(h * scale));
      if (
        width === w &&
        height === h &&
        target.width === pixelWidth &&
        target.height === pixelHeight
      )
        return;
      width = w;
      height = h;
      target.width = pixelWidth;
      target.height = pixelHeight;
      ctx.setTransform(pixelWidth / w, 0, 0, pixelHeight / h, 0, 0);
      drawing.resize(w, h);
      drawing.draw(phase.current, pointer, 0);
    };

    function changeResolution() {
      resolution.removeEventListener("change", changeResolution);
      resolution = readResolution();
      resolution.addEventListener("change", changeResolution);
      resize();
    }

    function move(event: PointerEvent) {
      if (
        paused ||
        reduced.matches ||
        event.pointerType === "touch" ||
        !width ||
        !height
      )
        return;
      hovered = true;
      targetX = event.offsetX / width;
      targetY = event.offsetY / height;
    }

    function leave() {
      hovered = false;
    }

    const visibility = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false;
      syncMotion();
    });
    const size = new ResizeObserver(resize);
    visibility.observe(area);
    size.observe(area);
    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", syncMotion);
    reduced.addEventListener("change", syncMotion);
    resolution.addEventListener("change", changeResolution);
    area.addEventListener("pointermove", move, { passive: true });
    area.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      visibility.disconnect();
      size.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", syncMotion);
      reduced.removeEventListener("change", syncMotion);
      resolution.removeEventListener("change", changeResolution);
      area.removeEventListener("pointermove", move);
      area.removeEventListener("pointerleave", leave);
    };
  }, [theme, paused, phase]);

  return (
    <div ref={surface} className="spectral-field" aria-hidden="true">
      <canvas ref={canvas} />
      <div className="spectral-seal">
        <LambdaMark />
      </div>
    </div>
  );
}
