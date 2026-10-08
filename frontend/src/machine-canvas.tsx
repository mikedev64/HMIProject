import { useEffect, useRef, useState } from "preact/hooks";
import { Badge, Popover } from "interface-components";
import type { Machine, Snapshot } from "./backend";
import { asBool, formatValue } from "./format";

/*
 * Lienzo 2D con las máquinas del mapa HMI (estilo PanelView):
 *
 *  - Vista general: todas las máquinas colocadas en el mundo, con estado
 *    (run/alarma) y nombre dibujados sobre el lienzo.
 *  - Hover: popup (Popover) con los datos en vivo del PLC bajo el cursor.
 *  - Clic: la máquina se centra y escala al alto de la pantalla con gap,
 *    y avisa al contenedor para abrir el panel lateral de edición.
 *
 * La cámara (scale + traslación) anima entre vista general y foco con
 * ease-out; el bucle de dibujo es un requestAnimationFrame continuo que lee
 * el estado actual por refs (los snapshots llegan cada pollIntervalMs).
 */

const WORLD_PAD = 60;
const WORLD_GAP = 70;
const LABEL_H = 62;
const FOCUS_GAP = 48;
const ANIM_MS = 320;

// Paleta (equivalente a los tokens --hmi-* de la librería).
const COLOR = {
        bg: "#0d1117",
        grid: "#161d27",
        surface: "#1c2532",
        border: "#2a3542",
        borderStrong: "#3d4c5e",
        text: "#e6edf3",
        dim: "#8b98a9",
        accent: "#4aa3ff",
        ok: "#3fb950",
        alarm: "#ff5c57",
};

interface Placed {
        machine: Machine;
        x: number;
        y: number;
        w: number;
        h: number;
}

interface World {
        items: Placed[];
        w: number;
        h: number;
}

interface Camera {
        scale: number;
        tx: number;
        ty: number;
}

interface HoverInfo {
        machine: Machine;
        x: number;
        y: number;
}

export interface MachineCanvasProps {
        machines: Machine[];
        snapshot: Snapshot;
        focusedId: string | null;
        onFocus: (id: string | null) => void;
}

function layout(machines: Machine[]): World {
        if (machines.length === 0) return { items: [], w: 0, h: 0 };
        const maxH = Math.max(...machines.map((m) => m.size.height));
        let cursor = WORLD_PAD;
        const items = machines.map((machine) => {
                const item: Placed = {
                        machine,
                        x: cursor,
                        y: WORLD_PAD + (maxH - machine.size.height) / 2,
                        w: machine.size.width,
                        h: machine.size.height,
                };
                cursor += machine.size.width + WORLD_GAP;
                return item;
        });
        const w = cursor - WORLD_GAP + WORLD_PAD;
        const h = WORLD_PAD * 2 + maxH + LABEL_H;
        return { items, w, h };
}

function overviewCamera(vw: number, vh: number, world: World): Camera {
        const margin = 48;
        const raw = Math.min((vw - margin * 2) / world.w, (vh - margin * 2) / world.h);
        const scale = Math.min(Math.max(raw, 0.05), 1.5);
        return { scale, tx: (vw - world.w * scale) / 2, ty: (vh - world.h * scale) / 2 };
}

function focusCamera(vw: number, vh: number, p: Placed): Camera {
        // La máquina se escala al alto de la pantalla dejando el gap, sin
        // desbordar el ancho disponible.
        const scale = Math.min((vh - FOCUS_GAP * 2) / p.h, (vw - FOCUS_GAP * 2) / p.w);
        return {
                scale,
                tx: vw / 2 - (p.x + p.w / 2) * scale,
                ty: vh / 2 - (p.y + p.h / 2) * scale,
        };
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
        const radius = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + w, y, x + w, y + h, radius);
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
        ctx.arcTo(x, y, x + w, y, radius);
        ctx.closePath();
}

function easeOutCubic(t: number): number {
        return 1 - Math.pow(1 - t, 3);
}

function lerpCamera(from: Camera, to: Camera, k: number): Camera {
        return {
                scale: from.scale + (to.scale - from.scale) * k,
                tx: from.tx + (to.tx - from.tx) * k,
                ty: from.ty + (to.ty - from.ty) * k,
        };
}

/** Tags numéricas representativas para los readouts de la vista de foco. */
function readoutTags(machine: Machine) {
        const numeric = machine.tags.filter((t) => t.dataType !== "bool");
        const proceso = numeric.filter((t) => t.group === "Proceso");
        return (proceso.length > 0 ? proceso : numeric).slice(0, 3);
}

export function MachineCanvas({ machines, snapshot, focusedId, onFocus }: MachineCanvasProps) {
        const wrapRef = useRef<HTMLDivElement | null>(null);
        const canvasRef = useRef<HTMLCanvasElement | null>(null);
        const [hover, setHover] = useState<HoverInfo | null>(null);

        // Estado vivo para el bucle de dibujo (se actualiza en cada render).
        const stateRef = useRef({ machines, snapshot, focusedId, hover });
        stateRef.current = { machines, snapshot, focusedId, hover };

        const cameraRef = useRef<Camera>({ scale: 1, tx: 0, ty: 0 });
        const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
        const worldRef = useRef<World>({ items: [], w: 0, h: 0 });

        // Caché de imágenes de máquina.
        useEffect(() => {
                for (const m of machines) {
                        if (imagesRef.current.has(m.id)) continue;
                        const img = new Image();
                        img.src = m.image;
                        imagesRef.current.set(m.id, img);
                }
        }, [machines]);

        // Bucle principal: resize + cámara animada + dibujo.
        useEffect(() => {
                const canvas = canvasRef.current;
                const wrap = wrapRef.current;
                if (!canvas || !wrap) return;
                const ctx = canvas.getContext("2d");
                if (!ctx) return;

                let vw = wrap.clientWidth;
                let vh = wrap.clientHeight;
                const dpr = Math.min(window.devicePixelRatio || 1, 2);

                const resize = () => {
                        vw = wrap.clientWidth;
                        vh = wrap.clientHeight;
                        canvas.width = Math.max(1, Math.round(vw * dpr));
                        canvas.height = Math.max(1, Math.round(vh * dpr));
                        canvas.style.width = `${vw}px`;
                        canvas.style.height = `${vh}px`;
                };
                resize();

                const observer = new ResizeObserver(resize);
                observer.observe(wrap);

                let raf = 0;
                let camKey = "";
                let from: Camera = cameraRef.current;
                let target: Camera = cameraRef.current;
                let animStart = performance.now();

                const draw = (now: number) => {
                        raf = requestAnimationFrame(draw);
                        const { machines: ms, snapshot: snap, focusedId: focus, hover: hv } = stateRef.current;

                        const world = layout(ms);
                        worldRef.current = world;
                        if (world.items.length === 0) {
                                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                                ctx.fillStyle = COLOR.bg;
                                ctx.fillRect(0, 0, vw, vh);
                                ctx.fillStyle = COLOR.dim;
                                ctx.font = "14px sans-serif";
                                ctx.textAlign = "center";
                                ctx.fillText("Sin máquinas en el mapa HMI", vw / 2, vh / 2);
                                return;
                        }

                        const focusedItem = world.items.find((p) => p.machine.id === focus) ?? null;
                        const key = `${focus}|${vw}x${vh}|${ms.map((m) => `${m.id}:${m.size.width}x${m.size.height}`).join(",")}`;
                        if (key !== camKey) {
                                from = cameraRef.current;
                                target = focusedItem ? focusCamera(vw, vh, focusedItem) : overviewCamera(vw, vh, world);
                                animStart = now;
                                camKey = key;
                        }
                        const k = easeOutCubic(Math.min(1, (now - animStart) / ANIM_MS));
                        const cam = k >= 1 ? target : lerpCamera(from, target, k);
                        cameraRef.current = cam;

                        const { scale, tx, ty } = cam;
                        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                        ctx.fillStyle = COLOR.bg;
                        ctx.fillRect(0, 0, vw, vh);

                        // Rejilla en espacio-mundo (se mueve y escala con la cámara).
                        const steps = [10, 20, 25, 50, 100, 200, 500];
                        const step = steps.find((s) => s * scale >= 30) ?? 500;
                        const x0 = (0 - tx) / scale;
                        const x1 = (vw - tx) / scale;
                        const y0 = (0 - ty) / scale;
                        const y1 = (vh - ty) / scale;
                        ctx.strokeStyle = COLOR.grid;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        for (let gx = Math.ceil(x0 / step) * step; gx <= x1; gx += step) {
                                const sx = Math.round(gx * scale + tx) + 0.5;
                                ctx.moveTo(sx, 0);
                                ctx.lineTo(sx, vh);
                        }
                        for (let gy = Math.ceil(y0 / step) * step; gy <= y1; gy += step) {
                                const sy = Math.round(gy * scale + ty) + 0.5;
                                ctx.moveTo(0, sy);
                                ctx.lineTo(vw, sy);
                        }
                        ctx.stroke();

                        const alarmPulse = 0.55 + 0.45 * Math.sin(now / 220);

                        for (const p of world.items) {
                                const sx = p.x * scale + tx;
                                const sy = p.y * scale + ty;
                                const sw = p.w * scale;
                                const sh = p.h * scale;
                                const isFocus = p.machine.id === focus;
                                const isHover = hv?.machine.id === p.machine.id;
                                const dimmed = focus !== null && !isFocus;

                                ctx.save();
                                ctx.globalAlpha = dimmed ? 0.16 : 1;

                                // Cuerpo de la máquina
                                const img = imagesRef.current.get(p.machine.id);
                                if (img && img.complete && img.naturalWidth > 0) {
                                        ctx.drawImage(img, sx, sy, sw, sh);
                                } else {
                                        roundRectPath(ctx, sx, sy, sw, sh, 12);
                                        ctx.fillStyle = COLOR.surface;
                                        ctx.fill();
                                        ctx.strokeStyle = COLOR.borderStrong;
                                        ctx.lineWidth = 2;
                                        ctx.stroke();
                                        ctx.fillStyle = COLOR.dim;
                                        ctx.font = "13px sans-serif";
                                        ctx.textAlign = "center";
                                        ctx.fillText(p.machine.type, sx + sw / 2, sy + sh / 2);
                                }

                                // Contorno: hover/foco resaltados
                                roundRectPath(ctx, sx, sy, sw, sh, 12);
                                if (isFocus) {
                                        ctx.strokeStyle = COLOR.accent;
                                        ctx.lineWidth = 3;
                                } else if (isHover) {
                                        ctx.strokeStyle = COLOR.accent;
                                        ctx.lineWidth = 2;
                                } else {
                                        ctx.strokeStyle = COLOR.border;
                                        ctx.lineWidth = 1;
                                }
                                ctx.stroke();

                                // LEDs de estado (run / alarma)
                                const run = asBool(snap.values?.[p.machine.statusTags?.run ?? ""]);
                                const alarm = asBool(snap.values?.[p.machine.statusTags?.alarm ?? ""]);
                                const ledY = sy + 16;
                                ctx.lineWidth = 2;
                                ctx.fillStyle = run ? COLOR.ok : COLOR.borderStrong;
                                ctx.beginPath();
                                ctx.arc(sx + 16, ledY, 6, 0, Math.PI * 2);
                                ctx.fill();
                                if (alarm) {
                                        ctx.globalAlpha = dimmed ? 0.16 : alarmPulse;
                                        ctx.fillStyle = COLOR.alarm;
                                        ctx.beginPath();
                                        ctx.arc(sx + 36, ledY, 6, 0, Math.PI * 2);
                                        ctx.fill();
                                        ctx.globalAlpha = dimmed ? 0.16 : 1;
                                } else {
                                        ctx.fillStyle = COLOR.borderStrong;
                                        ctx.beginPath();
                                        ctx.arc(sx + 36, ledY, 6, 0, Math.PI * 2);
                                        ctx.fill();
                                }

                                // Etiqueta bajo la máquina
                                const fs = Math.min(26, Math.max(12, Math.round(13 * Math.min(scale, 2))));
                                ctx.textAlign = "center";
                                ctx.fillStyle = COLOR.text;
                                ctx.font = `800 ${fs}px "Nunito", sans-serif`;
                                ctx.fillText(p.machine.name, sx + sw / 2, sy + sh + fs + 6);
                                ctx.fillStyle = COLOR.dim;
                                ctx.font = `${Math.round(fs * 0.72)}px "Nunito", sans-serif`;
                                ctx.fillText(p.machine.id, sx + sw / 2, sy + sh + fs * 1.75 + 6);

                                // En la vista de foco: readouts numéricos tipo PanelView
                                if (isFocus && !dimmed) {
                                        const tags = readoutTags(p.machine);
                                        const metrics = tags.map((t) => {
                                                const value = formatValue(t, snap.values?.[t.address]);
                                                const labelW = ctx.measureText(t.label).width;
                                                ctx.font = '800 18px "Nunito", sans-serif';
                                                const valueW = ctx.measureText(value).width;
                                                return { t, value, w: Math.max(labelW, valueW) + 28 };
                                        });
                                        const total = metrics.reduce((acc, m) => acc + m.w, 0) + (metrics.length - 1) * 12;
                                        let cx = sx + sw / 2 - total / 2;
                                        const chipY = sy + sh + fs * 2.2 + 22;
                                        for (const mchip of metrics) {
                                                roundRectPath(ctx, cx, chipY, mchip.w, 56, 10);
                                                ctx.fillStyle = COLOR.surface;
                                                ctx.fill();
                                                ctx.strokeStyle = COLOR.border;
                                                ctx.lineWidth = 1;
                                                ctx.stroke();
                                                ctx.textAlign = "center";
                                                ctx.fillStyle = COLOR.dim;
                                                ctx.font = '11px "Nunito", sans-serif';
                                                ctx.fillText(mchip.t.label, cx + mchip.w / 2, chipY + 18);
                                                ctx.fillStyle = COLOR.accent;
                                                ctx.font = '800 18px "Nunito", sans-serif';
                                                ctx.fillText(mchip.value, cx + mchip.w / 2, chipY + 42);
                                                cx += mchip.w + 12;
                                        }
                                }

                                ctx.restore();
                        }

                        canvas.style.cursor = hv ? "pointer" : "default";
                };

                raf = requestAnimationFrame(draw);
                return () => {
                        cancelAnimationFrame(raf);
                        observer.disconnect();
                };
        }, []);

        const hitTest = (sx: number, sy: number): Placed | null => {
                const { scale, tx, ty } = cameraRef.current;
                const wx = (sx - tx) / scale;
                const wy = (sy - ty) / scale;
                for (const p of worldRef.current.items) {
                        if (wx >= p.x && wx <= p.x + p.w && wy >= p.y && wy <= p.y + p.h + LABEL_H) return p;
                }
                return null;
        };

        const localPoint = (e: MouseEvent) => {
                const rect = wrapRef.current?.getBoundingClientRect();
                if (!rect) return null;
                return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };

        const handleMove = (e: MouseEvent) => {
                const pt = localPoint(e);
                if (!pt) return;
                const hit = hitTest(pt.x, pt.y);
                const current = stateRef.current.hover;
                if (!hit) {
                        if (current) setHover(null);
                        return;
                }
                if (current?.machine.id === hit.machine.id && current.x === pt.x && current.y === pt.y) return;
                setHover({ machine: hit.machine, x: pt.x, y: pt.y });
        };

        const handleClick = (e: MouseEvent) => {
                const pt = localPoint(e);
                if (!pt) return;
                const hit = hitTest(pt.x, pt.y);
                if (hit) {
                        if (hover) setHover(null);
                        onFocus(hit.machine.id);
                } else {
                        onFocus(null);
                }
        };

        const pop_pos =
                hover &&
                ({
                        x: Math.min(hover.x + 18, Math.max(8, (wrapRef.current?.clientWidth ?? 0) - 272)),
                        y: Math.min(hover.y + 14, Math.max(8, (wrapRef.current?.clientHeight ?? 0) - 216)),
                } as const);

        return (
                <div class="hm-stage" ref={wrapRef}>
                        <canvas ref={canvasRef} onMouseMove={handleMove} onMouseLeave={() => setHover(null)} onClick={handleClick} />
                        {hover && pop_pos && (
                                <Popover open x={pop_pos.x} y={pop_pos.y}>
                                        <div class="hm-pop__head">
                                                <span class="hm-pop__title">{hover.machine.name}</span>
                                                <Badge tone="neutral">{hover.machine.type}</Badge>
                                        </div>
                                        <div class="hm-pop__status">
                                                <Badge tone={asBool(snapshot.values?.[hover.machine.statusTags?.run ?? ""]) ? "ok" : "neutral"} dot>
                                                        {asBool(snapshot.values?.[hover.machine.statusTags?.run ?? ""]) ? "RUN" : "STOP"}
                                                </Badge>
                                                <Badge
                                                        tone={asBool(snapshot.values?.[hover.machine.statusTags?.alarm ?? ""]) ? "danger" : "neutral"}
                                                        dot
                                                >
                                                        ALARMA
                                                </Badge>
                                                {!snapshot.connected && <Badge tone="warn">SIN PLC</Badge>}
                                        </div>
                                        <ul class="hm-pop__list">
                                                {hover.machine.tags.slice(0, 5).map((tag) => (
                                                        <li key={tag.address}>
                                                                <span>{tag.label}</span>
                                                                <strong>{formatValue(tag, snapshot.values?.[tag.address])}</strong>
                                                        </li>
                                                ))}
                                        </ul>
                                        <div class="hm-pop__hint">Clic para centrar y editar</div>
                                </Popover>
                        )}
                </div>
        );
}
