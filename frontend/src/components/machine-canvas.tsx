import { useEffect, useRef, useState } from "preact/hooks";
import { Badge, Popover } from "interface-components";
import type { Machine, Snapshot } from "../api/backend";
import { asBool, formatValue } from "../lib/format";

const WORLD_PAD = 60;
const WORLD_GAP = 70;
const LABEL_H = 62;
const FOCUS_GAP = 48;
const ANIM_MS = 320;

const MIN_SCALE = 0.05;
const MAX_SCALE = 6;
const CAM_PAD = 48;
const CAM_EDGE = 80;

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
        const scale = Math.min(Math.max(raw, MIN_SCALE), 1.5);
        return { scale, tx: (vw - world.w * scale) / 2, ty: (vh - world.h * scale) / 2 };
}

function focusCamera(vw: number, vh: number, p: Placed): Camera {
        const raw = Math.min((vh - FOCUS_GAP * 2) / p.h, (vw - FOCUS_GAP * 2) / p.w);
        const scale = Math.min(Math.max(raw, MIN_SCALE), MAX_SCALE);
        return {
                scale,
                tx: vw / 2 - (p.x + p.w / 2) * scale,
                ty: vh / 2 - (p.y + p.h / 2) * scale,
        };
}

function clampAxis(tx: number, view: number, worldSize: number, scale: number): number {
        const screen = worldSize * scale;
        let lo: number;
        let hi: number;
        if (screen + CAM_PAD * 2 <= view) {
                lo = CAM_PAD;
                hi = view - CAM_PAD - screen;
        } else {
                lo = CAM_EDGE - screen;
                hi = view - CAM_EDGE;
        }
        if (lo > hi) return (view - screen) / 2;
        return Math.min(hi, Math.max(lo, tx));
}

function clampCamera(cam: Camera, vw: number, vh: number, world: World): Camera {
        const scale = Math.min(Math.max(cam.scale, MIN_SCALE), MAX_SCALE);
        return {
                scale,
                tx: clampAxis(cam.tx, vw, world.w, scale),
                ty: clampAxis(cam.ty, vh, world.h, scale),
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

function readoutTags(machine: Machine) {
        const numeric = machine.tags.filter((t) => t.dataType !== "bool");
        const proceso = numeric.filter((t) => t.group === "Proceso");
        return (proceso.length > 0 ? proceso : numeric).slice(0, 3);
}

export function MachineCanvas({ machines, snapshot, focusedId, onFocus }: MachineCanvasProps) {
        const wrapRef = useRef<HTMLDivElement | null>(null);
        const canvasRef = useRef<HTMLCanvasElement | null>(null);
        const [hover, setHover] = useState<HoverInfo | null>(null);

        const stateRef = useRef({ machines, snapshot, focusedId, hover });
        stateRef.current = { machines, snapshot, focusedId, hover };

        const cameraRef = useRef<Camera>({ scale: 1, tx: 0, ty: 0 });
        const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
        const worldRef = useRef<World>({ items: [], w: 0, h: 0 });
        const manualRef = useRef(false);
        const resetTickRef = useRef(0);
        const panRef = useRef<{ id: number; startX: number; startY: number; moved: boolean; cam: Camera } | null>(null);
        const vpRef = useRef({ w: 0, h: 0 });
        const zoomRef = useRef<HTMLSpanElement | null>(null);

        useEffect(() => {
                for (const m of machines) {
                        if (imagesRef.current.has(m.id)) continue;
                        const img = new Image();
                        img.src = m.image;
                        imagesRef.current.set(m.id, img);
                }
        }, [machines]);

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
                        vpRef.current = { w: vw, h: vh };
                };
                resize();

                const observer = new ResizeObserver(resize);
                observer.observe(wrap);

                let raf = 0;
                let camKey = "";
                let vpKey = "";
                let lastTick = resetTickRef.current;
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
                        const contentKey = `${focus}|${ms.map((m) => `${m.id}:${m.size.width}x${m.size.height}`).join(",")}`;
                        const sizeKey = `${vw}x${vh}`;
                        const goal = focusedItem ? focusCamera(vw, vh, focusedItem) : overviewCamera(vw, vh, world);
                        const tick = resetTickRef.current;

                        if (tick !== lastTick || contentKey !== camKey) {
                                from = cameraRef.current;
                                target = goal;
                                animStart = now;
                                manualRef.current = false;
                                camKey = contentKey;
                                vpKey = sizeKey;
                                lastTick = tick;
                        } else if (sizeKey !== vpKey) {
                                vpKey = sizeKey;
                                if (!manualRef.current) {
                                        from = cameraRef.current;
                                        target = goal;
                                        animStart = now;
                                }
                        }

                        let cam: Camera;
                        if (manualRef.current) {
                                cam = cameraRef.current;
                        } else {
                                const k = easeOutCubic(Math.min(1, (now - animStart) / ANIM_MS));
                                cam = k >= 1 ? target : lerpCamera(from, target, k);
                                cameraRef.current = cam;
                        }

                        const zoomPct = `${Math.round(cam.scale * 100)}%`;
                        if (zoomRef.current && zoomRef.current.textContent !== zoomPct) zoomRef.current.textContent = zoomPct;
                        const zoomAttr = cam.scale.toFixed(3);
                        if (wrap.dataset.zoom !== zoomAttr) wrap.dataset.zoom = zoomAttr;
                        const panAttr = `${Math.round(cam.tx)},${Math.round(cam.ty)}`;
                        if (wrap.dataset.pan !== panAttr) wrap.dataset.pan = panAttr;

                        const { scale, tx, ty } = cam;
                        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                        ctx.fillStyle = COLOR.bg;
                        ctx.fillRect(0, 0, vw, vh);

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

                                const alarm = asBool(snap.values?.[p.machine.statusTags?.alarm ?? ""]);
                                if (alarm) {
                                        roundRectPath(ctx, sx - 4, sy - 4, sw + 8, sh + 8, 15);
                                        ctx.globalAlpha = dimmed ? 0.16 : alarmPulse;
                                        ctx.strokeStyle = COLOR.alarm;
                                        ctx.lineWidth = 3;
                                        ctx.stroke();
                                        ctx.globalAlpha = dimmed ? 0.16 : 1;
                                }

                                const run = asBool(snap.values?.[p.machine.statusTags?.run ?? ""]);
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

                                const fs = Math.min(26, Math.max(12, Math.round(13 * Math.min(scale, 2))));
                                ctx.textAlign = "center";
                                ctx.fillStyle = COLOR.text;
                                ctx.font = `800 ${fs}px "Nunito", sans-serif`;
                                ctx.fillText(p.machine.name, sx + sw / 2, sy + sh + fs + 6);
                                ctx.fillStyle = COLOR.dim;
                                ctx.font = `${Math.round(fs * 0.72)}px "Nunito", sans-serif`;
                                ctx.fillText(p.machine.id, sx + sw / 2, sy + sh + fs * 1.75 + 6);

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

                        canvas.style.cursor = panRef.current?.moved ? "grabbing" : hv ? "pointer" : manualRef.current ? "grab" : "default";
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

        const localPoint = (e: { clientX: number; clientY: number }) => {
                const rect = wrapRef.current?.getBoundingClientRect();
                if (!rect) return null;
                return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };

        const zoomAt = (pt: { x: number; y: number }, factor: number) => {
                const cam = cameraRef.current;
                const next = Math.min(Math.max(cam.scale * factor, MIN_SCALE), MAX_SCALE);
                if (next === cam.scale) return;
                const wx = (pt.x - cam.tx) / cam.scale;
                const wy = (pt.y - cam.ty) / cam.scale;
                manualRef.current = true;
                setHover(null);
                cameraRef.current = clampCamera(
                        { scale: next, tx: pt.x - wx * next, ty: pt.y - wy * next },
                        vpRef.current.w,
                        vpRef.current.h,
                        worldRef.current,
                );
        };

        const zoomButton = (factor: number) => {
                zoomAt({ x: vpRef.current.w / 2, y: vpRef.current.h / 2 }, factor);
        };

        const resetView = () => {
                resetTickRef.current += 1;
                setHover(null);
                onFocus(null);
        };

        const handlePointerDown = (e: PointerEvent) => {
                if (e.button !== 0 && e.button !== 1) return;
                const pt = localPoint(e);
                if (!pt) return;
                panRef.current = { id: e.pointerId, startX: pt.x, startY: pt.y, moved: false, cam: cameraRef.current };
                canvasRef.current?.setPointerCapture?.(e.pointerId);
        };

        const handlePointerMove = (e: PointerEvent) => {
                const pt = localPoint(e);
                if (!pt) return;

                const pan = panRef.current;
                if (pan && pan.id === e.pointerId) {
                        const dx = pt.x - pan.startX;
                        const dy = pt.y - pan.startY;
                        if (!pan.moved && Math.hypot(dx, dy) > 4) {
                                pan.moved = true;
                                setHover(null);
                        }
                        if (pan.moved) {
                                manualRef.current = true;
                                cameraRef.current = clampCamera(
                                        { scale: pan.cam.scale, tx: pan.cam.tx + dx, ty: pan.cam.ty + dy },
                                        vpRef.current.w,
                                        vpRef.current.h,
                                        worldRef.current,
                                );
                                return;
                        }
                }

                const hit = hitTest(pt.x, pt.y);
                const current = stateRef.current.hover;
                if (!hit) {
                        if (current) setHover(null);
                        return;
                }
                if (current?.machine.id === hit.machine.id && current.x === pt.x && current.y === pt.y) return;
                setHover({ machine: hit.machine, x: pt.x, y: pt.y });
        };

        const handlePointerUp = (e: PointerEvent) => {
                const pan = panRef.current;
                if (!pan || pan.id !== e.pointerId) return;
                canvasRef.current?.releasePointerCapture?.(e.pointerId);
                panRef.current = null;
                if (pan.moved) return;

                const pt = localPoint(e);
                if (!pt) return;
                const hit = hitTest(pt.x, pt.y);
                if (hit) {
                        if (stateRef.current.hover) setHover(null);
                        onFocus(hit.machine.id);
                } else {
                        onFocus(null);
                }
        };

        useEffect(() => {
                const canvas = canvasRef.current;
                if (!canvas) return;
                const onWheel = (e: WheelEvent) => {
                        e.preventDefault();
                        const pt = localPoint(e);
                        if (!pt) return;
                        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
                        zoomAt(pt, Math.exp(-dy * 0.0016));
                };
                canvas.addEventListener("wheel", onWheel, { passive: false });
                return () => canvas.removeEventListener("wheel", onWheel);
        }, []);

        const pop_pos =
                hover &&
                ({
                        x: Math.min(hover.x + 18, Math.max(8, (wrapRef.current?.clientWidth ?? 0) - 272)),
                        y: Math.min(hover.y + 14, Math.max(8, (wrapRef.current?.clientHeight ?? 0) - 216)),
                } as const);

        return (
                <div class="hm-stage" ref={wrapRef}>
                        <canvas
                                ref={canvasRef}
                                onPointerDown={handlePointerDown}
                                onPointerMove={handlePointerMove}
                                onPointerUp={handlePointerUp}
                                onPointerCancel={() => (panRef.current = null)}
                                onPointerLeave={() => setHover(null)}
                        />
                        <div class="hm-stage__hud">
                                <button type="button" class="hm-hud__btn" title="Alejar (rueda del ratón)" onClick={() => zoomButton(1 / 1.3)}>
                                        −
                                </button>
                                <span class="hm-hud__zoom" ref={zoomRef}>
                                        100%
                                </span>
                                <button type="button" class="hm-hud__btn" title="Acercar (rueda del ratón)" onClick={() => zoomButton(1.3)}>
                                        +
                                </button>
                                <button
                                        type="button"
                                        class="hm-hud__btn hm-hud__btn--reset"
                                        title="Vista general (reset zoom y posición)"
                                        onClick={resetView}
                                >
                                        ⌂
                                </button>
                        </div>
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
