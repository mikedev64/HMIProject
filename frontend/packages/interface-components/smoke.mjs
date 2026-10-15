// Smoke test manual del HMI (modo preview: vite dev + simulador Node).
// Uso: node smoke.mjs   —  se ejecuta con el dev server y el simulador arriba.
//
// Cubre: pantalla de acceso (error + login correcto), pad numérico en modo
// sin --onlymouse, flujo completo con ?onlymouse (edición con teclado físico),
// faceplates parametrizados, banner global de alarmas con ack y bloqueo de
// escritura para el perfil viewer.
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

// Captura con reintentos: un fallo transitorio de composición no debe
// abortar el smoke (las aserciones sí).
const shot = async (name) => {
        for (let i = 0; i < 3; i++) {
                try {
                        await page.screenshot({ path: `/tmp/hmi-${name}.png` });
                        return;
                } catch (e) {
                        console.log(`SHOT_RETRY ${name}: ${String(e).split("\n")[0]}`);
                        await page.waitForTimeout(500);
                }
        }
        console.log(`SHOT_SKIPPED ${name}`);
};

const plcTags = async () => (await fetch(`${PLC}/tags`)).json();
const plcWrite = async (address, value) => {
        const res = await fetch(`${PLC}/write`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address, value }),
        });
        if (!res.ok) throw new Error(`PLC write HTTP ${res.status}`);
};

/* ------------------------------------------------------------------ login */

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".hm-login", { timeout: 10000 }).catch(() => fail("no apareció la pantalla de acceso"));
await shot("0-login");

// Credenciales inválidas → mensaje de error (misma verificación que Go).
await page.fill("#hm-user", "operador");
await page.fill("#hm-pass", "malamenta");
await page.click('.hm-login__card button[type="submit"]');
await page.waitForSelector(".hm-login__error", { timeout: 5000 }).catch(() => fail("un login inválido no mostró error"));
const loginErr = await page.locator(".hm-login__error").innerText();
console.log("LOGIN_ERROR:", JSON.stringify(loginErr));

// Login correcto (perfil operador: puede escribir).
// Teclado en pantalla: escribe en el campo activo (terminal táctil).
await page.click(".hm-login__kbdtoggle");
await page.click("#hm-user");
await page.locator(".hm-kbd__key", { hasText: "z" }).click();
const userWithKbd = await page.inputValue("#hm-user");
console.log("KBD_USER:", JSON.stringify(userWithKbd));
if (!userWithKbd.endsWith("z")) fail(`el teclado en pantalla no escribió en el campo (${userWithKbd})`);
await page.fill("#hm-user", "operador"); // restaura tras la prueba

await page.fill("#hm-pass", "operador123");
await page.click('.hm-login__card button[type="submit"]');
await page.waitForSelector(".hm-stage canvas", { timeout: 10000 }).catch(() => fail("el HMI no cargó tras el login"));
await page.waitForTimeout(1500); // animación de cámara + imágenes + primer snapshot
await shot("1-overview");

const topbar = await page.locator(".hm-top").innerText();
console.log("TOPBAR:", JSON.stringify(topbar));
if (!topbar.includes("PLC-LINEA-01")) fail("no se ve el nombre del PLC");
if (!(await page.locator(".hm-user").count())) fail("el topbar no muestra el usuario de la sesión");

// Chip de diagnóstico EtherNet/IP: la sesión EIP (seq a la vista, RPI y
// conexión en el tooltip) debe verse en el topbar, como el estado de
// conexión de un PanelView real.
const eipChip = page.locator(".hm-eip");
if ((await eipChip.count()) === 0) fail("el topbar no muestra el chip de diagnóstico EIP");
await page.waitForTimeout(800); // deja correr algunos paquetes implícitos
const eipText = (await eipChip.innerText()).trim();
const eipTitle = (await eipChip.getAttribute("title")) ?? "";
console.log("EIP_CHIP:", JSON.stringify(eipText), "TITLE:", JSON.stringify(eipTitle));
if (!eipText.includes("EIP")) fail(`el chip EIP no muestra «EIP»: ${eipText}`);
if (!/seq \d+/.test(eipText)) fail(`el chip EIP no muestra el nº de secuencia: ${eipText}`);
if (!/RPI \d+ ms/.test(eipTitle)) fail(`el tooltip EIP no muestra el RPI negociado: ${eipTitle}`);
if (!/sesión 0x/i.test(eipTitle)) fail(`el tooltip EIP no muestra el manejador de sesión: ${eipTitle}`);
// La secuencia avanza con los paquetes implícitos (producción T->O del PLC).
const seqA = Number((eipText.match(/seq (\d+)/) ?? [])[1] ?? -1);
await page.waitForTimeout(700);
const eipText2 = (await eipChip.innerText()).trim();
const seqB = Number((eipText2.match(/seq (\d+)/) ?? [])[1] ?? -1);
console.log(`EIP_SEQ: ${seqA} -> ${seqB}`);
if (!(seqB > seqA)) fail(`la secuencia EIP no avanza con los paquetes implícitos (${seqA} -> ${seqB})`);

/* ------------------------------------------------- pad numérico (sin flag) */

await page.locator(".hmi-list-item", { hasText: "Mezcladora 01" }).click();
await page.waitForSelector(".hmi-panel", { timeout: 5000 }).catch(() => fail("el panel de Mezcladora no abrió"));
await page.waitForTimeout(400);

const pad = page.locator(".hm-padbtn").first();
if ((await pad.count()) === 0) fail("el faceplate no muestra el control pad (sin --onlymouse debería)");
await pad.click();
await page.waitForSelector(".hmi-keypad", { timeout: 3000 }).catch(() => fail("el pad numérico no se abrió"));
await shot("2-keypad");

// Dígitos + Enter (el keypad captura el teclado físico en fase capture).
await page.keyboard.type("135");
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
if ((await page.locator(".hmi-keypad").count()) !== 0) fail("el pad no se cerró al confirmar");
const kpNotice = await page
        .locator(".hm-notice")
        .innerText()
        .catch(() => "(sin aviso)");
console.log("KEYPAD_NOTICE:", JSON.stringify(kpNotice));
if (!kpNotice.includes("N7:0 ← 135")) fail(`aviso del pad ausente: ${kpNotice}`);
const afterPad = await plcTags();
console.log(`PLC N7:0 = ${afterPad.values["N7:0"]} (esperado 135)`);
if (afterPad.values["N7:0"] !== 135) fail(`el pad no escribió en el PLC (N7:0=${afterPad.values["N7:0"]})`);

// Cancelar: reabrir y pulsar ✕ no debe cambiar nada.
await pad.click();
await page.waitForSelector(".hmi-keypad", { timeout: 3000 });
await page.locator('.hmi-keypad__key[aria-label="Cancelar"]').click();
await page.waitForTimeout(300);
if ((await page.locator(".hmi-keypad").count()) !== 0) fail("el pad no se cerró con Cancelar");

// Recetas: «Rápido 180°C» debe escribir N7:0=180 y N7:1=2200 en el PLC.
const recipesBlock = page.locator(".hm-recipes");
if ((await recipesBlock.count()) === 0) fail("el faceplate no muestra el bloque de recetas");
await recipesBlock.scrollIntoViewIfNeeded();
await page.locator(".hm-recipes__item", { hasText: "Rápido 180°C" }).locator("button", { hasText: "Cargar" }).click();
await page.waitForTimeout(800);
const afterRecipe = await plcTags();
console.log(`PLC tras receta: N7:0=${afterRecipe.values["N7:0"]} N7:1=${afterRecipe.values["N7:1"]}`);
if (afterRecipe.values["N7:0"] !== 180) fail(`la receta no escribió N7:0 (=${afterRecipe.values["N7:0"]})`);
if (afterRecipe.values["N7:1"] !== 2200) fail(`la receta no escribió N7:1 (=${afterRecipe.values["N7:1"]})`);
await shot("2b-recetas");

// minLevel admin: como operador, el botón de mantenimiento está deshabilitado.
const adminBtn = page.locator(".hmi-btn").filter({ hasText: "Reinicio contador" }).first();
await adminBtn.scrollIntoViewIfNeeded();
const adminBtnDisabled = await adminBtn.isDisabled();
console.log("ADMIN_BTN_DISABLED_OPERADOR:", adminBtnDisabled);
if (!adminBtnDisabled) fail("un control con minLevel admin no debe operarse como operador");

await page.keyboard.press("Escape"); // deja la máquina
await page.waitForTimeout(300);

/* ------------------- flujo completo con ?onlymouse (teclado físico) ------ */

await page.goto(`${BASE}/?onlymouse=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".hm-stage canvas", { timeout: 10000 }).catch(() => fail("el HMI no cargó tras recargar con ?onlymouse"));
if ((await page.locator(".hm-login").count()) !== 0) fail("la sesión no sobrevivió la recarga (pidió login otra vez)");
await page.waitForTimeout(1500);

// --- hover sobre la máquina del centro (cinta-01)
const box = await page.locator(".hm-stage canvas").boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy, { steps: 8 });
await page.waitForSelector(".hmi-popover", { timeout: 5000 }).catch(() => fail("popover de hover no apareció"));
await page.waitForTimeout(400);
await shot("3-hover");
const pop = await page.locator(".hmi-popover").innerText();
console.log("POPOVER:", JSON.stringify(pop));
if (!pop.includes("Cinta transportadora 01")) fail("popover no muestra la máquina esperada");

// --- clic: centra la máquina y abre el panel lateral
await page.mouse.click(cx, cy);
await page.waitForSelector(".hmi-panel", { timeout: 5000 }).catch(() => fail("panel lateral no abrió"));
await page.waitForTimeout(800);
await shot("4-focus");
const title = await page.locator(".hmi-panel__title").innerText();
console.log("PANEL_TITLE:", title);
if (title !== "Cinta transportadora 01") fail(`panel equivocado: ${title}`);

// --- editar una tag rw (N7:10 setpoint velocidad) y verificar en el PLC
// (elegimos un valor DISTINTO al actual: escribir el mismo es un no-op)
const preWrite = await plcTags();
let setpoint = 20 + Math.floor(Math.random() * 79); // 20..99
while (setpoint === preWrite.values["N7:10"]) setpoint = 20 + Math.floor(Math.random() * 79);
const field = page.locator(".hmi-field").filter({ hasText: "N7:10" }).first();
if ((await field.count()) === 0) fail("campo N7:10 no está en el panel");
const input = field.locator("input");
await input.click();
await input.fill(String(setpoint));
await input.press("Enter");
await page.waitForTimeout(600);
const notice = await page
        .locator(".hm-notice")
        .innerText()
        .catch(() => "(sin aviso)");
console.log("NOTICE:", JSON.stringify(notice));
if (!notice.includes(`N7:10 ← ${setpoint}`)) fail(`aviso de escritura ausente: ${notice}`);
await shot("5-write");

const tags = await plcTags();
console.log(`PLC N7:10 = ${tags.values["N7:10"]} (esperado ${setpoint})`);
if (tags.values["N7:10"] !== setpoint) fail(`el PLC no recibió la escritura (N7:10=${tags.values["N7:10"]})`);

// --- una tag ro no debe poder editarse
const roField = page.locator(".hmi-field").filter({ hasText: "N7:11" }).first();
const roDisabled = await roField.locator("input").isDisabled();
console.log("RO_INPUT_DISABLED:", roDisabled);
if (!roDisabled) fail("tag ro no está bloqueada");

// --- botones del faceplate: Marcha/Paro escriben el tag mando (B3/10)
const marchaBtn = page
        .locator(".hmi-panel .hmi-btn")
        .filter({ hasText: /^Marcha$/ })
        .first();
await marchaBtn.click();
await page.waitForTimeout(500);
const tagsRun = await plcTags();
console.log(`PLC B3/10 tras Marcha = ${tagsRun.values["B3/10"]}`);
if (tagsRun.values["B3/10"] !== true) fail("el botón Marcha no encendió el motor (B3/10)");
const paroBtn = page
        .locator(".hmi-panel .hmi-btn")
        .filter({ hasText: /^Paro$/ })
        .first();
await paroBtn.click();
await page.waitForTimeout(500);
const tagsStop = await plcTags();
console.log(`PLC B3/10 tras Paro = ${tagsStop.values["B3/10"]}`);
if (tagsStop.values["B3/10"] === true) fail("el botón Paro no paró el motor (B3/10)");

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
const marcha = page.locator(".hmi-field").filter({ hasText: "B3/20" }).locator('[role="switch"]').first();
const tagsBefore = await plcTags();
const before = tagsBefore.values["B3/20"] === true;
await marcha.click();
await page.waitForTimeout(500);
const tags2 = await plcTags();
console.log(`PLC B3/20 = ${tags2.values["B3/20"]} (antes ${before})`);
if (tags2.values["B3/20"] === before) fail(`el switch no conmutó la bomba (B3/20=${tags2.values["B3/20"]})`);

const pressure = page.locator(".hmi-field").filter({ hasText: "F8:20" }).locator("input").first();
const preBar = await plcTags();
let bar = Number((2 + Math.random() * 6).toFixed(1)); // 2.0..8.0 bar
while (bar === preBar.values["F8:20"]) bar = Number((2 + Math.random() * 6).toFixed(1));
await pressure.click();
await pressure.fill(String(bar));
await pressure.press("Enter");
await page.waitForTimeout(500);
const tags3 = await plcTags();
console.log(`PLC F8:20 = ${tags3.values["F8:20"]} (esperado ${bar})`);
if (tags3.values["F8:20"] !== bar) fail(`setpoint float mal (F8:20=${tags3.values["F8:20"]})`);
await shot("6-bomba");

// --- hover fuera de máquinas: el popover desaparece
const box2 = await page.locator(".hm-stage canvas").boundingBox();
await page.mouse.move(box2.x + 12, box2.y + 12, { steps: 4 });
await page.waitForTimeout(300);
const popCount = await page.locator(".hmi-popover").count();
console.log("POPOVER_OFF_MACHINE:", popCount);
if (popCount !== 0) fail("el popover aparece sin estar sobre una máquina");

// --- navegación del lienzo: zoom con límites, pan con arrastre y reset
const stage = page.locator(".hm-stage");
const canvasBox = await page.locator(".hm-stage canvas").boundingBox();
const scx = canvasBox.x + canvasBox.width / 2;
const scy = canvasBox.y + canvasBox.height / 2;
await page.mouse.move(scx, scy);

const zoom0 = Number(await stage.getAttribute("data-zoom"));
await page.mouse.wheel(0, -600); // acercar
await page.waitForTimeout(250);
const zoomIn = Number(await stage.getAttribute("data-zoom"));
console.log(`ZOOM_IN: ${zoom0} -> ${zoomIn}`);
if (!(zoomIn > zoom0)) fail(`la rueda no hizo zoom in (${zoom0} -> ${zoomIn})`);

for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -600);
await page.waitForTimeout(250);
const zoomMax = Number(await stage.getAttribute("data-zoom"));
console.log("ZOOM_MAX:", zoomMax);
if (zoomMax > 6.001) fail(`zoom sin límite superior: ${zoomMax}`);

for (let i = 0; i < 80; i++) await page.mouse.wheel(0, 600); // alejar hasta el límite
await page.waitForTimeout(250);
const zoomMin = Number(await stage.getAttribute("data-zoom"));
console.log("ZOOM_MIN:", zoomMin);
if (zoomMin < 0.049) fail(`zoom sin límite inferior: ${zoomMin}`);
await shot("7-zoomout");

// botones del HUD +/-
await page.locator(".hm-hud__btn", { hasText: "+" }).click();
await page.waitForTimeout(250);
const zoomBtn = Number(await stage.getAttribute("data-zoom"));
console.log(`ZOOM_BUTTON: ${zoomMin} -> ${zoomBtn}`);
if (!(zoomBtn > zoomMin)) fail(`el botón + no hizo zoom (${zoomMin} -> ${zoomBtn})`);

// reset (⌂): vuelve a la vista general y cierra el panel
await page.locator(".hm-hud__btn--reset").click();
await page.waitForTimeout(700);
const panelAfterReset = await page.locator(".hmi-panel").count();
const zoomReset = Number(await stage.getAttribute("data-zoom"));
console.log(`RESET: zoom=${zoomReset} panel=${panelAfterReset}`);
if (panelAfterReset !== 0) fail("el reset no dejó la máquina enfocada");
await shot("8-reset");

// pan: arrastrar sobre una máquina NO debe abrir el panel (fue arrastre, no clic)
const pan0 = await stage.getAttribute("data-pan");
await page.mouse.move(scx, scy);
await page.mouse.down();
await page.mouse.move(scx + 140, scy + 60, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
const pan1 = await stage.getAttribute("data-pan");
const panelAfterPan = await page.locator(".hmi-panel").count();
console.log(`PAN: ${pan0} -> ${pan1} (panel=${panelAfterPan})`);
if (pan0 === pan1) fail(`el arrastre no movió la cámara (${pan0} -> ${pan1})`);
if (panelAfterPan !== 0) fail("el arrastre abrió el panel como si fuera clic");

// --- faceplate parametrizado: pestañas definidas en la config de la máquina
await page.locator(".hmi-list-item", { hasText: "Mezcladora 01" }).click();
await page.waitForSelector(".hmi-panel", { timeout: 5000 }).catch(() => fail("el panel de Mezcladora no abrió"));
await page.waitForTimeout(400);
const tabs = await page.locator(".hmi-tab").allInnerTexts();
console.log("TABS:", JSON.stringify(tabs));
if (tabs.length !== 4) fail(`se esperaban 4 pestañas, hay ${tabs.length}: ${JSON.stringify(tabs)}`);
if ((await page.locator(".hmi-field").count()) === 0) fail("la pestaña Control no muestra campos");
if ((await page.locator(".hm-lamp").count()) === 0) fail("la pestaña Control no muestra lámparas (bloque sections)");

await page.locator(".hmi-tab").filter({ hasText: "Proceso" }).click();
await page.waitForSelector(".hmi-gauge", { timeout: 3000 }).catch(() => fail("la pestaña Proceso no muestra el gauge"));
const barsCount = await page.locator(".hmi-bar").count();
console.log("PROCESO_BARS:", barsCount);
if (barsCount === 0) fail("la pestaña Proceso no muestra barras");
await shot("9-proceso");

await page.locator(".hmi-tab").filter({ hasText: "Tendencia" }).click();
await page.waitForTimeout(200);
const sparks = await page.locator(".hmi-sparkline svg").count();
console.log("SPARKLINES:", sparks);
if (sparks === 0) fail("la pestaña Tendencia no muestra gráficos con datos");

// Cursor del sparkline: al pasar el puntero muestra valor y hora de la muestra.
await page.locator(".hmi-sparkline svg").first().hover();
await page.waitForTimeout(250);
const cursorTip = (await page.locator(".hmi-sparkline__tip").first().innerText()).trim();
console.log("CURSOR_TIP:", JSON.stringify(cursorTip));
if (!/\d{2}:\d{2}:\d{2}/.test(cursorTip)) fail(`el cursor no muestra la hora de la muestra: «${cursorTip}»`);

// CSV de tendencia con fecha_hora por muestra.
const dlTrendPromise = page.waitForEvent("download", { timeout: 5000 });
await page.locator(".hm-trend__toolbar button").filter({ hasText: "CSV" }).click();
const trendName = (await dlTrendPromise).suggestedFilename();
console.log("TREND_CSV:", trendName);
if (!trendName.startsWith("hmi-trend-mezcladora-01-") || !trendName.endsWith(".csv")) fail(`CSV de tendencia inesperado: ${trendName}`);

await page.locator(".hmi-tab").filter({ hasText: "Alarmas" }).click();
await page.waitForTimeout(200);
if ((await page.locator(".hm-alarms, .hm-empty").count()) === 0) fail("la pestaña Alarmas no muestra contenido");
await page.locator(".hmi-tab").filter({ hasText: "Control" }).click();
if ((await page.locator(".hmi-field").count()) === 0) fail("volver a Control no restauró los campos");

// --- exportar snapshot a CSV (descarga con nombre hmi-snapshot-*.csv)
const dlPromise = page.waitForEvent("download", { timeout: 5000 });
await page.locator(".hm-tools button").filter({ hasText: "CSV" }).click();
const download = await dlPromise;
const csvName = download.suggestedFilename();
console.log("CSV:", csvName);
if (!csvName.startsWith("hmi-snapshot-") || !csvName.endsWith(".csv")) fail(`nombre de CSV inesperado: ${csvName}`);

// --- registro global de alarmas (topbar) + cierre con Escape en dos pasos
await page.locator(".hm-alarmlog__btn").click();
await page.waitForSelector(".hm-alarmlog", { timeout: 3000 }).catch(() => fail("el registro de alarmas no se abrió"));
await page.waitForTimeout(200);
await shot("10-alarmlog");
const logText = await page.locator(".hm-alarmlog").innerText();
console.log("ALARM_LOG:", JSON.stringify(logText));
if (!logText.includes("Registro de alarmas")) fail("el registro de alarmas no muestra su cabecera");

await page.keyboard.press("Escape"); // primero cierra el registro…
await page.waitForTimeout(200);
if ((await page.locator(".hm-alarmlog").count()) !== 0) fail("Escape no cerró el registro de alarmas");
if ((await page.locator(".hmi-panel").count()) === 0) fail("Escape con el registro abierto dejó la máquina");
await page.keyboard.press("Escape"); // …y ahora sí deja la máquina
await page.waitForTimeout(200);
if ((await page.locator(".hmi-panel").count()) !== 0) fail("el segundo Escape no cerró el panel");

// --- banner global de alarmas: forzar alarma en el simulador y reconocerla
await plcWrite("B3/12", true); // alarma_atasco de la cinta (manual, anula la sim)
await page.waitForSelector(".hm-banner-alarm", { timeout: 8000 }).catch(() => fail("el banner de alarmas no apareció"));
await page.waitForTimeout(200);
await shot("11-banner");
const bannerText = await page.locator(".hm-banner-alarm").innerText();
console.log("BANNER:", JSON.stringify(bannerText));
if (!bannerText.includes("Alarma de atasco")) fail("el banner no muestra la alarma activa");
await page.locator(".hm-banner-alarm .hmi-btn").filter({ hasText: "Reconocer todo" }).click();
await page.waitForTimeout(300);
// Tras el ack, la alarma reconocida no debe seguir exigiéndose en el banner
// (otra alarma aleatoria del simulador sí podría aparecer: no se falla por eso).
const bannerAfterAck = await page.locator(".hm-banner-alarm").count();
if (bannerAfterAck > 0) {
        const stillThere = await page.locator(".hm-banner-alarm").innerText();
        if (stillThere.includes("Alarma de atasco")) fail("el reconocimiento no quitó la alarma del banner");
}
console.log("BANNER_TRAS_ACK:", bannerAfterAck);
await plcWrite("B3/12", false); // restaura la tag

// --- el histórico de alarmas se PERSISTE: tras recargar sigue en el registro
await page.goto(`${BASE}/?onlymouse=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".hm-stage canvas", { timeout: 10000 }).catch(() => fail("el HMI no cargó tras la recarga"));
if ((await page.locator(".hm-login").count()) !== 0) fail("la sesión no sobrevivió la segunda recarga");
await page.waitForTimeout(1200);
await page.locator(".hm-alarmlog__btn").click();
await page.waitForSelector(".hm-alarmlog", { timeout: 3000 }).catch(() => fail("no abrió el registro tras la recarga"));
const persistedLog = await page.locator(".hm-alarmlog").innerText();
console.log("HISTORICO_PERSISTENTE:", persistedLog.includes("Alarma de atasco"));
if (!persistedLog.includes("Alarma de atasco")) fail("el histórico de alarmas no sobrevivió la recarga (localStorage)");
await page.keyboard.press("Escape"); // cierra el registro
await page.waitForTimeout(200);

// --- perfil viewer: sesión válida pero SIN escritura en el PLC
await page.locator('.hm-user button[title="Cerrar sesión"]').click();
await page.waitForSelector(".hm-login", { timeout: 5000 }).catch(() => fail("Salir no volvió a la pantalla de acceso"));
await page.fill("#hm-user", "consulta");
await page.fill("#hm-pass", "consulta123");
await page.click('.hm-login__card button[type="submit"]');
await page.waitForSelector(".hm-stage canvas", { timeout: 10000 }).catch(() => fail("no entró con el perfil consulta"));
await page.waitForTimeout(800);
await page.locator(".hmi-list-item", { hasText: "Mezcladora 01" }).click();
await page.waitForSelector(".hmi-panel", { timeout: 5000 });
await page.waitForTimeout(400);
const viewerUser = await page.locator(".hm-user").innerText();
console.log("VIEWER_USER:", JSON.stringify(viewerUser));
if (!viewerUser.includes("Consulta")) fail("el topbar no refleja el perfil viewer");
const viewerField = page.locator(".hmi-field").filter({ hasText: "N7:0" }).first();
const viewerDisabled = await viewerField
        .locator("input")
        .isDisabled()
        .catch(() => false);
console.log("VIEWER_INPUT_DISABLED:", viewerDisabled);
if (!viewerDisabled) fail("el perfil viewer no tiene los campos de escritura bloqueados");
if ((await page.locator(".hm-padbtn").count()) !== 0) fail("el perfil viewer aún ve el pad activo");
await shot("12-viewer");

// --- el botón de pantalla completa existe (no se pulsa: headless puede rechazarlo)
if ((await page.locator('button[title="Pantalla completa"]').count()) !== 1) fail("falta el botón de pantalla completa");

// --- perfil admin: auditoría + editor de configuración + gestión de usuarios
await page.locator('.hm-user button[title="Cerrar sesión"]').click();
await page.waitForSelector(".hm-login", { timeout: 5000 });
await page.fill("#hm-user", "admin");
await page.fill("#hm-pass", "admin123");
await page.click('.hm-login__card button[type="submit"]');
await page.waitForSelector(".hm-stage canvas", { timeout: 10000 }).catch(() => fail("no entró con el perfil admin"));
await page.waitForTimeout(900);

// Auditoría: las escrituras anteriores aparecen con su autor.
await page.locator('button[title*="auditoría"]').click();
await page.waitForSelector(".hm-auditlog", { timeout: 3000 }).catch(() => fail("no abrió el registro de auditoría"));
await page.waitForTimeout(300);
const auditText = await page.locator(".hm-auditlog").innerText();
console.log("AUDIT_OK:", auditText.includes("N7:10") && auditText.includes("operador"));
if (!auditText.includes("N7:10")) fail("la auditoría no registra la escritura de N7:10");
if (!auditText.includes("operador")) fail("la auditoría no registra el autor (operador)");
if (!auditText.includes("Reconocimiento alarma")) fail("la auditoría no registra el pulso de ack");
await shot("13-auditoria");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// Editor de configuración: validación con avisos y guardado real.
await page.locator('button[title*="Configuración"]').click();
await page.waitForSelector(".hm-config", { timeout: 3000 }).catch(() => fail("no abrió el espacio de configuración"));
await page.waitForTimeout(300);
const origJson = await page.locator(".hm-cfgeditor__code").inputValue();
if (!origJson.includes('"title": "Control"')) fail("el editor no carga el JSON de la máquina");

// (a) introducimos un error (dirección duplicada) → bloquea el guardado.
await page.fill(".hm-cfgeditor__code", origJson.replace('"address": "B3/20"', '"address": "B3/21"'));
await page.locator(".hm-cfgeditor__toolbar button").filter({ hasText: "Validar" }).click();
await page.waitForTimeout(200);
const errCount = await page.locator(".hm-cfgeditor__issue.is-error").count();
console.log("VALIDACION_ERRORES:", errCount);
if (errCount === 0) fail("la validación no detectó la dirección duplicada");
await page.locator(".hm-cfgeditor__toolbar button").filter({ hasText: "Guardar" }).click();
await page.waitForTimeout(200);
const blocked = await page.locator(".hm-cfgeditor__issues .hm-notice--error").count();
if (blocked === 0) fail("el guardado no se bloqueó con errores de validación");

// (b) guardado válido: renombramos la pestaña Control → Mando.
await page.locator(".hm-cfgeditor__toolbar button").filter({ hasText: "Descartar" }).click();
await page.waitForTimeout(150);
await page.fill(".hm-cfgeditor__code", origJson.replace('"title": "Control"', '"title": "Mando"'));
await page.locator(".hm-cfgeditor__toolbar button").filter({ hasText: "Guardar" }).click();
await page.waitForTimeout(600);
const saveOk = await page
        .locator(".hm-cfgeditor__issues .hm-notice--ok")
        .innerText()
        .catch(() => "");
console.log("GUARDADO:", JSON.stringify(saveOk));
if (!saveOk.includes("guardada")) fail(`el editor no guardó la configuración: ${saveOk}`);

// (c) gestión de usuarios: crear el usuario tecnico (operator).
await page.locator(".hm-config__tab").filter({ hasText: "Usuarios" }).click();
await page.waitForTimeout(300);
await page.locator(".hm-users__new input").nth(0).fill("tecnico");
await page.locator(".hm-users__new input").nth(1).fill("secreto1");
await page.locator(".hm-users__new button").filter({ hasText: "Añadir" }).click();
await page.waitForTimeout(400);
const usersNow = await page.locator(".hm-users__table").innerText();
if (!usersNow.includes("tecnico")) fail("la gestión de usuarios no creó a tecnico");
await shot("14-config");
await page.locator('.hm-config__close[aria-label="Cerrar configuración"]').click();
await page.waitForTimeout(200);

// El cambio de configuración se ve en la UI (Bomba: Control → Mando).
await page.locator(".hmi-list-item", { hasText: "Bomba de proceso 01" }).click();
await page.waitForSelector(".hmi-panel", { timeout: 5000 }).catch(() => fail("el panel de Bomba no abrió tras guardar"));
await page.waitForTimeout(300);
const bombaTabs = await page.locator(".hmi-tab").allInnerTexts();
console.log("BOMBA_TABS:", JSON.stringify(bombaTabs));
if (!bombaTabs.includes("Mando")) fail(`la pestaña renombrada no aparece: ${JSON.stringify(bombaTabs)}`);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// minLevel admin: como admin, el botón de mantenimiento SÍ está habilitado.
await page.locator(".hmi-list-item", { hasText: "Mezcladora 01" }).click();
await page.waitForSelector(".hmi-panel", { timeout: 5000 });
await page.waitForTimeout(300);
const adminBtn2 = page.locator(".hmi-btn").filter({ hasText: "Reinicio contador" }).first();
await adminBtn2.scrollIntoViewIfNeeded();
if (await adminBtn2.isDisabled()) fail("como admin, el control con minLevel admin debería estar habilitado");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// --- el usuario tecnico creado desde la app puede entrar
await page.locator('.hm-user button[title="Cerrar sesión"]').click();
await page.waitForSelector(".hm-login", { timeout: 5000 });
await page.fill("#hm-user", "tecnico");
await page.fill("#hm-pass", "secreto1");
await page.click('.hm-login__card button[type="submit"]');
await page.waitForSelector(".hm-stage canvas", { timeout: 10000 }).catch(() => fail("no entró con el usuario tecnico"));
await page.waitForTimeout(700);
const tecnicoUser = await page.locator(".hm-user").innerText();
console.log("TECNICO_USER:", JSON.stringify(tecnicoUser));
if (!tecnicoUser.includes("tecnico") || !tecnicoUser.includes("Operador")) fail(`el perfil de tecnico no refleja el alta: ${tecnicoUser}`);

// --- bloqueo de cuenta: 5 fallos seguidos bloquean el acceso
await page.locator('.hm-user button[title="Cerrar sesión"]').click();
await page.waitForSelector(".hm-login", { timeout: 5000 });
for (let i = 1; i <= 5; i++) {
        await page.fill("#hm-user", "tecnico");
        await page.fill("#hm-pass", `mal-${i}`);
        await page.click('.hm-login__card button[type="submit"]');
        await page.waitForTimeout(400); // PBKDF2 + render del error
}
const lockErr = await page
        .locator(".hm-login__error")
        .innerText()
        .catch(() => "");
console.log("BLOQUEO:", JSON.stringify(lockErr));
if (!lockErr.includes("bloqueada")) fail(`la cuenta no se bloqueó tras ${5} fallos: ${lockErr}`);
// Incluso con la contraseña correcta sigue bloqueada.
await page.fill("#hm-pass", "secreto1");
await page.click('.hm-login__card button[type="submit"]');
await page.waitForTimeout(250);
const lockErr2 = await page
        .locator(".hm-login__error")
        .innerText()
        .catch(() => "");
if (!lockErr2.includes("bloqueada")) fail(`la cuenta bloqueada aceptó la contraseña correcta: ${lockErr2}`);
await shot("15-bloqueo");

console.log("PAGE_ERRORS:", JSON.stringify(errors));
await browser.close();
console.log("SMOKE_OK");
