// Smoke test manual del HMI (modo preview: vite dev + simulador Node).
// Uso: node smoke.mjs   —  se ejecuta con el dev server y el simulador arriba.
import { chromium } from "playwright";

const BASE = process.env.HMI_BASE ?? "http://localhost:5173";
const PLC = "http://127.0.0.1:4100";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
page.on("console", (m) => {
        if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

const fail = (msg) => {
        console.error(`FAIL: ${msg}`);
        console.error("ERRORS:", JSON.stringify(errors, null, 2));
        process.exit(1);
};

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".hm-stage canvas", { timeout: 10000 }).catch(() => fail("canvas no apareció"));
await page.waitForTimeout(1500); // animación de cámara + imágenes + primer snapshot
await page.screenshot({ path: "/tmp/hmi-1-overview.png" });

const topbar = await page.locator(".hm-top").innerText();
console.log("TOPBAR:", JSON.stringify(topbar));
if (!topbar.includes("PLC-LINEA-01")) fail("no se ve el nombre del PLC");

// --- hover sobre la máquina del centro (cinta-01)
const box = await page.locator(".hm-stage canvas").boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy, { steps: 8 });
await page.waitForSelector(".hmi-popover", { timeout: 5000 }).catch(() => fail("popover de hover no apareció"));
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/hmi-2-hover.png" });
const pop = await page.locator(".hmi-popover").innerText();
console.log("POPOVER:", JSON.stringify(pop));
if (!pop.includes("Cinta transportadora 01")) fail("popover no muestra la máquina esperada");

// --- clic: centra la máquina y abre el panel lateral
await page.mouse.click(cx, cy);
await page.waitForSelector(".hmi-panel", { timeout: 5000 }).catch(() => fail("panel lateral no abrió"));
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/hmi-3-focus.png" });
const title = await page.locator(".hmi-panel__title").innerText();
console.log("PANEL_TITLE:", title);
if (title !== "Cinta transportadora 01") fail(`panel equivocado: ${title}`);

// --- editar una tag rw (N7:10 setpoint velocidad) y verificar en el PLC
const setpoint = 20 + Math.floor(Math.random() * 79); // 20..99, distinto del valor actual
const field = page.locator(".hmi-field").filter({ hasText: "N7:10" }).first();
if ((await field.count()) === 0) fail("campo N7:10 no está en el panel");
const input = field.locator("input");
await input.click();
await input.fill(String(setpoint));
await input.press("Enter");
await page.waitForTimeout(600);
const notice = await page.locator(".hm-notice").innerText().catch(() => "(sin aviso)");
console.log("NOTICE:", JSON.stringify(notice));
if (!notice.includes(`N7:10 ← ${setpoint}`)) fail(`aviso de escritura ausente: ${notice}`);
await page.screenshot({ path: "/tmp/hmi-4-write.png" });

const tags = await (await fetch(`${PLC}/tags`)).json();
console.log(`PLC N7:10 = ${tags.values["N7:10"]} (esperado ${setpoint})`);
if (tags.values["N7:10"] !== setpoint) fail(`el PLC no recibió la escritura (N7:10=${tags.values["N7:10"]})`);

// --- una tag ro no debe poder editarse
const roField = page.locator(".hmi-field").filter({ hasText: "N7:11" }).first();
const roDisabled = await roField.locator("input").isDisabled();
console.log("RO_INPUT_DISABLED:", roDisabled);
if (!roDisabled) fail("tag ro no está bloqueada");

// --- Escape deja la máquina
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
const panelCount = await page.locator(".hmi-panel").count();
console.log("PANEL_AFTER_ESC:", panelCount);
if (panelCount !== 0) fail("Escape no cerró el panel");

// --- bomba-01: switch bool (rw) y setpoint float (rw, paso 0.1)
await page.locator(".hmi-list-item", { hasText: "Bomba de proceso 01" }).click();
await page.waitForSelector(".hmi-panel", { timeout: 5000 });
await page.waitForTimeout(400);
const marcha = page.locator(".hmi-field").filter({ hasText: "B3/20" }).locator('[role="switch"]');
const tagsBefore = await (await fetch(`${PLC}/tags`)).json();
const before = tagsBefore.values["B3/20"] === true;
await marcha.click();
await page.waitForTimeout(500);
const tags2 = await (await fetch(`${PLC}/tags`)).json();
console.log(`PLC B3/20 = ${tags2.values["B3/20"]} (antes ${before})`);
if (tags2.values["B3/20"] === before) fail(`el switch no conmutó la bomba (B3/20=${tags2.values["B3/20"]})`);

const pressure = page.locator(".hmi-field").filter({ hasText: "F8:20" }).locator("input");
const bar = Number((2 + Math.random() * 6).toFixed(1)); // 2.0..8.0 bar
await pressure.click();
await pressure.fill(String(bar));
await pressure.press("Enter");
await page.waitForTimeout(500);
const tags3 = await (await fetch(`${PLC}/tags`)).json();
console.log(`PLC F8:20 = ${tags3.values["F8:20"]} (esperado ${bar})`);
if (tags3.values["F8:20"] !== bar) fail(`setpoint float mal (F8:20=${tags3.values["F8:20"]})`);
await page.screenshot({ path: "/tmp/hmi-5-bomba.png" });

// --- hover fuera de máquinas: el popover desaparece
const box2 = await page.locator(".hm-stage canvas").boundingBox();
await page.mouse.move(box2.x + 12, box2.y + 12, { steps: 4 });
await page.waitForTimeout(300);
const popCount = await page.locator(".hmi-popover").count();
console.log("POPOVER_OFF_MACHINE:", popCount);
if (popCount !== 0) fail("el popover aparece sin estar sobre una máquina");

console.log("PAGE_ERRORS:", JSON.stringify(errors));
await browser.close();
console.log("SMOKE_OK");
