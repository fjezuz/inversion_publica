/* =====================================================================
   Inversión pública al detalle – lógica de la web
   Lee los JSON que genera procesar_mef_json.R
   ===================================================================== */

// Carpeta de los JSON, relativa a este index.html
// (index.html en web_app/03_web  ->  JSON en web_app/02_salida/01_datos_abiertos_mef)
const RUTA_DATOS = "./datos/";

// Periodos de gestión regional y municipal
const GESTIONES = ["2015-2018", "2019-2022", "2023-2026"];

// Nombres cortos de las fuentes de recursos (rubros)
const RUBROS = [
  { clave: "ORDINARIOS",     nombre: "Recursos ordinarios" },
  { clave: "CANON",          nombre: "Canon, sobrecanon y regalías" },
  { clave: "COMPENSACION",   nombre: "FONCOMUN" },
  { clave: "IMPUESTOS",      nombre: "Impuestos municipales" },
  { clave: "DIRECTAMENTE",   nombre: "Recursos directamente recaudados" },
  { clave: "DONACIONES",     nombre: "Donaciones y transferencias" },
  { clave: "CREDITO",        nombre: "Operaciones de crédito (endeudamiento)" },
  { clave: "CONTRIBUCIONES", nombre: "Contribuciones a fondos" }
];

const app = document.getElementById("app");

const datos = {
  entidades: [],      // catálogo
  porId: {},          // ID -> entidad
  indicadores: [],    // entidad x año
  indPorId: {},       // ID -> [filas por año]
  anios: [],          // años disponibles
  anioActual: null,   // último año de los datos
  anioEnCurso: null   // el último año, si todavía no termina
};

let graficos = [];    // gráficos dibujados (para borrarlos al cambiar de página)
let observadores = []; // vigilan el ancho de los mapas de árbol


/* ---------------------------------------------------------------------
   Utilidades
   --------------------------------------------------------------------- */
const fmtNum = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 });
const fmtEntero = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 });

function soles(v) {
  if (v === null || v === undefined || isNaN(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e9) return "S/ " + fmtNum.format(v / 1e9) + " mil M";
  if (a >= 1e6) return "S/ " + fmtNum.format(v / 1e6) + " M";
  if (a >= 1e3) return "S/ " + fmtEntero.format(v / 1e3) + " mil";
  return "S/ " + fmtEntero.format(v);
}
function pct(v, dec = 1) {
  if (v === null || v === undefined || isNaN(v)) return "–";
  return (v * 100).toFixed(dec) + " %";
}
function div(a, b) { return b > 0 ? a / b : null; }
function promedio(lista) {
  const v = lista.filter(x => x !== null && x !== undefined && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function escapar(t) {
  return String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function sinTildes(t) {
  return String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}
// "MUNICIPALIDAD PROVINCIAL DE ANTA" -> "Municipalidad Provincial de Anta"
const MENORES = new Set(["de", "del", "la", "las", "los", "y", "e", "el", "en", "para", "con", "a", "al", "por"]);
function titulo(t) {
  if (!t) return "";
  return String(t).toLowerCase().split(/(\s+)/).map((p, i) =>
    (i > 0 && MENORES.has(p)) ? p : p.charAt(0).toUpperCase() + p.slice(1)
  ).join("");
}
function color(nombre) {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}
function opciones(lista, elegido, todos) {
  return (todos ? `<option value="">${todos}</option>` : "") +
    lista.map(v => `<option value="${escapar(v)}" ${v === elegido ? "selected" : ""}>${escapar(titulo(v))}</option>`).join("");
}
function opcionesAnio(anios, elegido) {
  return anios.slice().reverse().map(a =>
    `<option value="${a}" ${a === elegido ? "selected" : ""}>${a}${a === datos.anioEnCurso ? " (en curso)" : ""}</option>`).join("");
}

async function leerJSON(archivo, opcional = false) {
  const r = await fetch(RUTA_DATOS + archivo);
  if (!r.ok) {
    if (opcional) return [];
    throw new Error("No se encontró " + RUTA_DATOS + archivo);
  }
  return r.json();
}

function borrarGraficos() {
  graficos.forEach(g => g.destroy());
  graficos = [];
  observadores.forEach(o => o.disconnect());
  observadores = [];
  ocultarTooltip();
}

function descargarCSV(filas, nombre) {
  if (!filas.length) return;
  const cols = Object.keys(filas[0]);
  const lineas = [cols.join(",")].concat(
    filas.map(f => cols.map(c => {
      const v = f[c] ?? "";
      return /[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
    }).join(","))
  );
  const blob = new Blob(["﻿" + lineas.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

function miniBarra(v) {
  const ancho = v === null || v === undefined ? 0 : Math.max(0, Math.min(1, v)) * 100;
  return `<span class="mini"><span class="mini__pista"><span class="mini__relleno" style="width:${ancho}%"></span></span><span>${pct(v)}</span></span>`;
}

function esLocal(e) { return (e.NIVEL || "").includes("LOCAL"); }
function tieneGestiones(e) { return esLocal(e) || (e.NIVEL || "").includes("REGIONAL"); }


/* ---------------------------------------------------------------------
   Carga inicial
   --------------------------------------------------------------------- */
async function iniciar() {
  try {
    const [entidades, indicadores] = await Promise.all([
      leerJSON("entidades.json"),
      leerJSON("indicadores_entidad.json")
    ]);
    datos.entidades = entidades;
    entidades.forEach(e => {
      e.NOMBRE_T = titulo(e.NOMBRE);
      e.BUSCAR = sinTildes(e.NOMBRE + " " + (e.PROVINCIA || "") + " " + (e.DISTRITO || ""));
      datos.porId[e.ID] = e;
    });

    datos.indicadores = indicadores;
    indicadores.forEach(f => {
      (datos.indPorId[f.ID] = datos.indPorId[f.ID] || []).push(f);
    });

    datos.anios = [...new Set(indicadores.map(f => f.ANIO))].sort((a, b) => a - b);
    datos.anioActual = datos.anios[datos.anios.length - 1];
    datos.anioEnCurso = datos.anioActual >= new Date().getFullYear() ? datos.anioActual : null;

    window.addEventListener("hashchange", enrutar);
    enrutar();
  } catch (err) {
    app.innerHTML = `
      <div class="error">
        <h2>No se pudieron cargar los datos</h2>
        <p>${escapar(err.message)}.</p>
        <p>Revisa dos cosas: que la constante <code>RUTA_DATOS</code> en <code>app.js</code> apunte a la carpeta de los JSON,
        y que la web se abra desde un servidor local (por ejemplo <code>servr::httd()</code> en R o Live Server en VS Code),
        no con doble clic en el archivo.</p>
      </div>`;
  }
}


/* ---------------------------------------------------------------------
   Rutas: #/  ·  #/entidad/ID/AÑO  ·  #/metodologia
   --------------------------------------------------------------------- */
function enrutar() {
  borrarGraficos();
  const partes = location.hash.replace(/^#\/?/, "").split("/");
  const ruta = partes[0] || "inicio";

  document.querySelectorAll(".menu a").forEach(a => {
    const activa = a.dataset.ruta === (ruta === "entidad" ? "inicio" : ruta);
    activa ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });

  if (ruta === "entidad" && partes[1]) {
    paginaEntidad(decodeURIComponent(partes[1]), partes[2] ? Number(partes[2]) : null);
  } else if (ruta === "metodologia") {
    paginaMetodologia();
  } else {
    paginaInicio();
  }
  window.scrollTo(0, 0);
}


/* ---------------------------------------------------------------------
   Página de inicio: buscador + ranking con filtros en cascada
   Nivel de gobierno -> Departamento -> Provincia, y el año siempre a mano
   --------------------------------------------------------------------- */
const filtro = { nivel: "GOBIERNOS LOCALES", depto: "", prov: "", anio: null, orden: "P", dir: "asc", mostrar: 100, monto: "PIM" };
let graficoRanking = null;

function paginaInicio() {
  document.title = "Inversión pública al detalle";
  if (!filtro.anio) filtro.anio = datos.anioActual;

  app.innerHTML = `
    <section class="portada">
      <h1>Cuánto presupuesto tuvo cada entidad pública y cuánto llegó a invertir</h1>
      <p>Presupuesto, ejecución y proyectos de inversión de municipalidades, gobiernos regionales y entidades
         nacionales del Perú, de ${datos.anios[0]} a ${datos.anioActual}.</p>
      <div class="buscador" role="combobox" aria-expanded="false" aria-haspopup="listbox" aria-owns="sugerencias">
        <label for="buscar" class="sr">Buscar una entidad</label>
        <input id="buscar" type="search" autocomplete="off"
               placeholder="Escribe una municipalidad, provincia o distrito (ej.: Anta)"
               aria-autocomplete="list" aria-controls="sugerencias">
        <ul id="sugerencias" class="sugerencias" role="listbox" hidden></ul>
      </div>
    </section>

    <section class="bloque" aria-labelledby="t-ranking">
      <div class="filtros filtros--cascada" id="filtros"></div>
      <div class="bloque__cabeza" style="margin-top:20px">
        <div>
          <h2 id="t-ranking"></h2>
          <p class="bloque__nota">Orden por avance de la inversión: devengado de proyectos entre su PIM.
             El puesto se calcula entre las entidades que se muestran.</p>
        </div>
      </div>
      <div class="tabla-scroll"><table id="tabla-ranking"></table></div>
      <p class="bloque__nota" id="nota-ranking"></p>

      <div class="subbloque" id="sb-pim-ranking" hidden>
        <div class="bloque__cabeza">
          <div>
            <h3 id="t-pim-ranking"></h3>
            <p class="bloque__nota" id="n-pim-ranking"></p>
          </div>
          <label class="campo">Monto
            <select id="f-pim-tipo">
              <option value="PIM">PIM total</option>
              <option value="PIM_INV">PIM de inversión</option>
              <option value="DEVENGADO">Devengado total</option>
            </select>
          </label>
        </div>
        <ul class="leyenda" id="ley-pim-ranking"></ul>
        <div class="grafico grafico--alto"><canvas id="g-pim-ranking" role="img" aria-label="PIM de cada entidad por año"></canvas></div>
      </div>
    </section>`;

  activarBuscador();
  dibujarFiltros();
  dibujarRanking();
  document.getElementById("f-pim-tipo").addEventListener("change", e => { filtro.monto = e.target.value; dibujarRanking(); });
}

function dibujarFiltros() {
  const niveles = [...new Set(datos.entidades.map(e => e.NIVEL))].filter(Boolean).sort();
  const local = filtro.nivel.includes("LOCAL");
  const deptos = [...new Set(datos.entidades.filter(esLocal).map(e => e.DEPARTAMENTO))].filter(Boolean).sort();
  const provs = filtro.depto
    ? [...new Set(datos.entidades.filter(e => esLocal(e) && e.DEPARTAMENTO === filtro.depto).map(e => e.PROVINCIA))].filter(Boolean).sort()
    : [];

  const caja = document.getElementById("filtros");
  caja.innerHTML = `
    <label class="campo">Nivel de gobierno
      <select id="f-nivel">${opciones(niveles, filtro.nivel)}</select>
    </label>
    ${local ? `
    <label class="campo">Departamento
      <select id="f-depto">${opciones(deptos, filtro.depto, "Todo el Perú")}</select>
    </label>` : ""}
    ${local && filtro.depto ? `
    <label class="campo">Provincia
      <select id="f-prov">${opciones(provs, filtro.prov, "Todas las provincias")}</select>
    </label>` : ""}
    <label class="campo campo--anio">Año
      <select id="f-anio">${opcionesAnio(datos.anios, filtro.anio)}</select>
    </label>`;

  const cambiar = (clave, reiniciar) => e => {
    filtro[clave] = clave === "anio" ? Number(e.target.value) : e.target.value;
    reiniciar.forEach(k => { filtro[k] = ""; });
    filtro.mostrar = 100;
    dibujarFiltros();
    dibujarRanking();
    document.getElementById("f-" + clave).focus();
  };
  document.getElementById("f-nivel").addEventListener("change", cambiar("nivel", ["depto", "prov"]));
  if (document.getElementById("f-depto")) document.getElementById("f-depto").addEventListener("change", cambiar("depto", ["prov"]));
  if (document.getElementById("f-prov")) document.getElementById("f-prov").addEventListener("change", cambiar("prov", []));
  document.getElementById("f-anio").addEventListener("change", cambiar("anio", []));
}

function dibujarRanking() {
  const { nivel, depto, prov, anio } = filtro;
  const local = nivel.includes("LOCAL");

  let filas = datos.indicadores
    .filter(f => f.ANIO === anio)
    .map(f => ({ ...f, ent: datos.porId[f.ID] }))
    .filter(f => f.ent && f.ent.NIVEL === nivel &&
                 (!depto || f.ent.DEPARTAMENTO === depto) &&
                 (!prov || f.ent.PROVINCIA === prov));

  // puesto entre las entidades mostradas (empates comparten puesto)
  const conInv = filas.filter(f => f.AVANCE_INV !== null && f.AVANCE_INV !== undefined)
                      .sort((a, b) => b.AVANCE_INV - a.AVANCE_INV);
  conInv.forEach((f, i) => { f.P = (i > 0 && f.AVANCE_INV === conInv[i - 1].AVANCE_INV) ? conInv[i - 1].P : i + 1; });

  const col = filtro.orden, s = filtro.dir === "asc" ? 1 : -1;
  filas.sort((a, b) => {
    const va = col === "NOMBRE" ? a.ent.NOMBRE : a[col], vb = col === "NOMBRE" ? b.ent.NOMBRE : b[col];
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return (va > vb ? 1 : va < vb ? -1 : 0) * s;
  });

  // título según el nivel de detalle
  const lugar = prov ? `de la provincia de ${titulo(prov)} (${titulo(depto)})` : depto ? `de ${titulo(depto)}` : local ? "de todo el Perú" : "";
  document.getElementById("t-ranking").textContent =
    `Ranking de ${titulo(nivel).toLowerCase()} ${lugar} en ${anio}${anio === datos.anioEnCurso ? " (en curso)" : ""}`;

  const cab = (c, t, num = true) =>
    `<th class="${num ? "num" : ""}" scope="col"><button data-col="${c}" ${filtro.orden === c ? `data-orden="${filtro.dir}"` : "data-orden"}>${t}</button></th>`;

  const ubicacion = e => !local ? "" : prov ? titulo(e.DISTRITO) : depto ? titulo(e.PROVINCIA) : `${titulo(e.PROVINCIA)}, ${titulo(e.DEPARTAMENTO)}`;

  const tabla = document.getElementById("tabla-ranking");
  tabla.innerHTML = filas.length ? `
    <thead><tr>
      ${cab("P", "Puesto", false)}
      ${cab("NOMBRE", "Entidad", false)}
      ${cab("PIM_INV", "PIM inversión")}
      ${cab("DEV_INV", "Devengado inversión")}
      ${cab("AVANCE_INV", "Avance inversión")}
      ${cab("AVANCE", "Avance total")}
      ${cab("PCT_PIM_INV", "% del PIM en inversión")}
    </tr></thead>
    <tbody>
      ${filas.slice(0, filtro.mostrar).map(f => `
        <tr class="fila-enlace" data-id="${escapar(f.ID)}">
          <td class="puesto">${f.P ?? "–"}</td>
          <td><a href="#/entidad/${encodeURIComponent(f.ID)}/${anio}">${escapar(f.ent.NOMBRE_T)}</a>
              ${ubicacion(f.ent) ? `<span class="sub">${escapar(ubicacion(f.ent))}</span>` : ""}</td>
          <td class="num">${soles(f.PIM_INV)}</td>
          <td class="num">${soles(f.DEV_INV)}</td>
          <td class="num">${miniBarra(f.AVANCE_INV)}</td>
          <td class="num">${pct(f.AVANCE)}</td>
          <td class="num">${pct(f.PCT_PIM_INV)}</td>
        </tr>`).join("")}
    </tbody>` : `<tbody><tr><td class="vacio">No hay entidades con esos filtros en ${anio}.</td></tr></tbody>`;

  tabla.querySelectorAll("th button").forEach(b => b.addEventListener("click", () => {
    const c = b.dataset.col;
    filtro.dir = (filtro.orden === c) ? (filtro.dir === "asc" ? "desc" : "asc") : ((c === "P" || c === "NOMBRE") ? "asc" : "desc");
    filtro.orden = c;
    dibujarRanking();
  }));
  tabla.querySelectorAll("tr.fila-enlace").forEach(tr => tr.addEventListener("click", e => {
    if (e.target.tagName !== "A") location.hash = `#/entidad/${encodeURIComponent(tr.dataset.id)}/${anio}`;
  }));

  const nota = document.getElementById("nota-ranking");
  nota.innerHTML = `${filas.length} entidades; ${conInv.length} con PIM de inversión en ${anio}.` +
    (anio === datos.anioEnCurso ? " Año en curso: el avance seguirá subiendo hasta diciembre." : "") +
    (filas.length > filtro.mostrar ? ` <button class="boton" id="r-mas" type="button">Mostrar 100 más</button>` : "");
  const mas = document.getElementById("r-mas");
  if (mas) mas.addEventListener("click", () => { filtro.mostrar += 100; dibujarRanking(); });

  // gráfico de montos por entidad: solo con departamento, provincia o niveles regional/nacional
  dibujarGraficoRanking(filas.map(f => f.ent), lugar, local && !depto);
}

// Líneas con el PIM de cada entidad a lo largo de los años
function dibujarGraficoRanking(entidades, lugar, ocultar) {
  const caja = document.getElementById("sb-pim-ranking");
  if (graficoRanking) { graficoRanking.destroy(); graficos = graficos.filter(g => g !== graficoRanking); graficoRanking = null; }
  caja.hidden = ocultar || !entidades.length;
  if (caja.hidden) return;

  const campo = filtro.monto;
  const nombreMonto = { PIM: "PIM total", PIM_INV: "PIM de inversión", DEVENGADO: "Devengado total" }[campo];
  const anios = datos.anios;
  const serieDe = id => anios.map(a => { const r = (datos.indPorId[id] || []).find(x => x.ANIO === a); return r ? r[campo] : null; });

  // las 8 entidades con más recursos en todo el periodo van en color; el resto, en gris
  const conTotal = entidades.map(e => {
    const v = serieDe(e.ID);
    return { e, v, total: v.reduce((t, x) => t + (x || 0), 0) };
  }).sort((a, b) => b.total - a.total);
  const destacadas = conTotal.slice(0, 8);
  const resto = conTotal.slice(8);

  document.getElementById("t-pim-ranking").textContent =
    `${nombreMonto} de cada entidad por año${lugar ? " " + lugar.replace(/^de /, "en ").replace(/^de la /, "en la ") : ""}`;
  document.getElementById("n-pim-ranking").textContent =
    `Para dimensionar los recursos con los que contó cada entidad. ` +
    (resto.length ? `En color, las ${destacadas.length} con más recursos en todo el periodo; en gris, las otras ${resto.length}.` : "");

  const ley = destacadas.map((x, i) => `<li><i class="linea" style="background:var(--cat-${i + 1})"></i>${escapar(x.e.NOMBRE_T)}</li>`).join("") +
    (resto.length ? `<li><i class="linea" style="background:var(--neutro-dato)"></i>Otras ${resto.length} entidades</li>` : "");
  document.getElementById("ley-pim-ranking").innerHTML = ley;

  const op = conBandas(opcionesBase(), filtro.nivel.includes("LOCAL") || filtro.nivel.includes("REGIONAL"));
  op.interaction = { mode: "nearest", intersect: false };
  op.scales.y.ticks = { callback: v => soles(v) };
  op.plugins.tooltip.callbacks = { label: c => ` ${c.dataset.label}: ${soles(c.raw)}` };
  op.onClick = (evt, el) => {            // clic en una línea: abre la ficha de esa entidad
    if (el.length) location.hash = `#/entidad/${encodeURIComponent(graficoRanking.data.datasets[el[0].datasetIndex].id)}/${filtro.anio}`;
  };

  const gris = color("--neutro-dato"), sup = color("--superficie");
  const ds = resto.map(x => ({
    id: x.e.ID, label: x.e.NOMBRE_T, data: x.v, borderColor: gris, backgroundColor: gris,
    borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, tension: 0, order: 2
  })).concat(destacadas.map((x, i) => {
    const c = color("--cat-" + (i + 1));
    return { id: x.e.ID, label: x.e.NOMBRE_T, data: x.v, borderColor: c, backgroundColor: c,
             borderWidth: 2, pointRadius: 2.5, pointHoverRadius: 6, pointBorderColor: sup, pointBorderWidth: 1.5, tension: 0, order: 1 };
  }));

  graficoRanking = new Chart(document.getElementById("g-pim-ranking"), {
    type: "line", data: { labels: anios, datasets: ds }, options: op, plugins: [bandasGestion]
  });
  graficos.push(graficoRanking);
}

function activarBuscador() {
  const input = document.getElementById("buscar");
  const lista = document.getElementById("sugerencias");
  const caja = input.parentElement;
  let actual = -1;

  const cerrar = () => { lista.hidden = true; caja.setAttribute("aria-expanded", "false"); actual = -1; };

  input.addEventListener("input", () => {
    const q = sinTildes(input.value.trim());
    if (q.length < 2) return cerrar();
    const palabras = q.split(/\s+/);
    const res = datos.entidades.filter(e => palabras.every(p => e.BUSCAR.includes(p))).slice(0, 8);
    lista.innerHTML = res.length
      ? res.map((e, i) => `<li role="option" id="op-${i}"><a href="#/entidad/${encodeURIComponent(e.ID)}">
            ${escapar(e.NOMBRE_T)}<small>${escapar(titulo(e.NIVEL))}${e.DEPARTAMENTO ? " – " + escapar(titulo(e.DEPARTAMENTO)) : ""}${esLocal(e) && e.PROVINCIA ? ", " + escapar(titulo(e.PROVINCIA)) : ""}</small></a></li>`).join("")
      : `<li class="vacio" style="padding:10px 12px">No hay coincidencias. Prueba con el nombre del distrito o la provincia.</li>`;
    lista.hidden = false;
    caja.setAttribute("aria-expanded", "true");
    actual = -1;
  });

  input.addEventListener("keydown", e => {
    const enlaces = [...lista.querySelectorAll("a")];
    if (!enlaces.length || lista.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      actual = (actual + (e.key === "ArrowDown" ? 1 : -1) + enlaces.length) % enlaces.length;
      enlaces.forEach((a, i) => a.classList.toggle("activa", i === actual));
    } else if (e.key === "Enter") {
      e.preventDefault();
      (enlaces[actual] || enlaces[0]).click();
    } else if (e.key === "Escape") {
      cerrar();
    }
  });
  document.addEventListener("click", e => { if (!caja.contains(e.target)) cerrar(); });
}


/* ---------------------------------------------------------------------
   Ficha de entidad
   --------------------------------------------------------------------- */
async function paginaEntidad(id, anioPedido) {
  const ent = datos.porId[id];
  const serie = (datos.indPorId[id] || []).slice().sort((a, b) => a.ANIO - b.ANIO);
  if (!ent || !serie.length) {
    app.innerHTML = `<div class="error"><h2>No se encontró la entidad</h2><p>El código ${escapar(id)} no está en los datos. <a href="#/">Vuelve al buscador</a>.</p></div>`;
    return;
  }
  document.title = ent.NOMBRE_T + " – Inversión pública al detalle";
  app.innerHTML = `<p class="cargando">Cargando ${escapar(ent.NOMBRE_T)}…</p>`;

  const [funciones, mensual, proyectos, rubros] = await Promise.all([
    leerJSON("funciones/" + id + ".json", true),
    leerJSON("mensual/" + id + ".json", true),
    leerJSON("proyectos/" + id + ".json", true),
    leerJSON("rubros/" + id + ".json", true)
  ]);

  const anios = serie.map(f => f.ANIO);
  const anio = anios.includes(anioPedido) ? anioPedido : anios[anios.length - 1];  // por defecto: el año actual
  const f = serie.find(x => x.ANIO === anio);
  const enCurso = anio === datos.anioEnCurso;
  const local = esLocal(ent);
  const conGestiones = tieneGestiones(ent);

  const ubic = [ent.DISTRITO, ent.PROVINCIA, ent.DEPARTAMENTO].filter(Boolean).map(titulo);
  const lugarRanking = local ? "de " + titulo(ent.DEPARTAMENTO) : "de su nivel";

  app.innerHTML = `
    <section class="ficha-cabeza">
      <div>
        <p class="migas"><a href="#/">Buscar y comparar</a> / ${escapar(titulo(ent.NIVEL))}</p>
        <h1>${escapar(ent.NOMBRE_T)}</h1>
        <p class="ubicacion">${escapar(local ? ubic.join(", ") : titulo(ent.NIVEL))}</p>
      </div>
      <label class="campo selector-anio">Año
        <select id="sel-anio">${opcionesAnio(anios, anio)}</select>
      </label>
    </section>

    <!-- 1. Avance del presupuesto -->
    <section class="bloque regla-bloque" aria-labelledby="t-regla">
      <div class="regla-titulo">
        <h2 id="t-regla">Avance del presupuesto en ${anio}${enCurso ? " (año en curso)" : ""}</h2>
        <p class="regla-cifra">${pct(f.AVANCE)}</p>
      </div>
      <div class="regla" role="img" aria-label="Avance del presupuesto: ${pct(f.AVANCE)} del PIM total">
        <div class="regla__pista">
          <div class="regla__relleno" style="width:${Math.min(1, f.AVANCE || 0) * 100}%"></div>
          <div class="regla__marcas"></div>
        </div>
        <div class="regla__escala"><span>0 %</span><span>50 %</span><span>100 %</span></div>
      </div>
      <div class="regla-pie">
        <span>Devengado <strong>${soles(f.DEVENGADO)}</strong> de un PIM de <strong>${soles(f.PIM)}</strong></span>
        <span>Avance de la inversión <strong>${pct(f.AVANCE_INV)}</strong> (${soles(f.DEV_INV)} de ${soles(f.PIM_INV)})</span>
        ${f.PUESTO ? `<span>Puesto <strong>${f.PUESTO} de ${f.TOTAL_GRUPO}</strong> ${escapar(lugarRanking)} en avance de la inversión</span>` : ""}
      </div>
    </section>

    <!-- 2. Presupuesto: PIM total por año + fuentes de recursos del año -->
    <section class="bloque" aria-labelledby="t-pres">
      <h2 id="t-pres">Presupuesto en ${anio}</h2>
      <dl class="indicadores">
        ${kpi("PIM total", soles(f.PIM), "PIA " + soles(f.PIA))}
        ${kpi("Devengado total", soles(f.DEVENGADO), "avance " + pct(f.AVANCE))}
        ${kpi("PIM de inversión", soles(f.PIM_INV), "proyectos")}
        ${kpi("PIM en inversión", pct(f.PCT_PIM_INV), "del PIM total")}
      </dl>
      <h3>PIM y devengado total por año</h3>
      <p class="bloque__nota">La distancia entre las dos líneas es lo que no se llegó a ejecutar cada año.</p>
      <ul class="leyenda" style="margin-top:10px">
        <li><i class="linea" style="background:var(--tinta-3)"></i>PIM total</li>
        <li><i class="linea" style="background:var(--serie-1)"></i>Devengado total</li>
        <li><i style="background:rgba(227, 73, 72, 0.18)"></i>Sin ejecutar</li>
        ${conGestiones ? `<li><i style="background:var(--banda);border:1px solid var(--linea)"></i>Periodos de gestión</li>` : ""}
      </ul>
      <div class="grafico"><canvas id="g-pim" role="img" aria-label="PIM total y devengado total por año"></canvas></div>

      <div class="subbloque">
        <h3>De dónde vino el dinero en ${anio}: fuentes de recursos</h3>
        <p class="bloque__nota">El tamaño de cada recuadro es su parte del PIM; el color, cuánto se ejecutó de esa fuente.</p>
        ${rubros.some(r => r.ANIO === anio)
          ? `<div class="arbol" id="m-fuentes"></div>${leyendaAvance(enCurso ? "Año en curso: el avance seguirá subiendo." : "")}`
          : `<p class="vacio">No hay datos de fuentes de recursos. Corre la sección 9 del script de R.</p>`}
      </div>
    </section>

    <!-- 3. Comparación entre gestiones -->
    ${conGestiones ? bloqueGestiones(serie) : ""}

    <!-- 4. En qué se invirtió -->
    <section class="bloque" aria-labelledby="t-calor">
      <div class="bloque__cabeza">
        <div>
          <h2 id="t-calor">En qué se gastó en cada ${conGestiones ? "gestión" : "periodo"}: reparto por función</h2>
          <p class="bloque__nota" id="nota-arbol-fun"></p>
        </div>
        <div class="filtros">
          <fieldset class="grupo-checks">
            <legend>${conGestiones ? "Gestiones" : "Periodos"}</legend>
            ${GESTIONES.map(g => `<label class="check"><input type="checkbox" name="g-arbol" value="${g}" checked> ${g.replace("-", "–")}</label>`).join("")}
          </fieldset>
          <label class="campo">Mostrar
            <select id="f-arbol-modo">
              <option value="GASTO">Gasto efectivo (devengado)</option>
              <option value="PROGRAMADO">Lo programado (PIM) y su avance</option>
            </select>
          </label>
          <label class="campo">Presupuesto
            <select id="f-arbol-fun">
              <option value="INV">Solo proyectos de inversión</option>
              <option value="TOTAL">Todo el presupuesto</option>
            </select>
          </label>
        </div>
      </div>
      ${funciones.length ? `<div class="arboles" id="arboles-fun"></div><div id="ley-arbol-fun"></div>`
                         : `<p class="vacio">No hay datos por función para esta entidad.</p>`}

      <div class="subbloque">
      <h3>Cómo cambió el reparto: % del PIM de inversión por función y año</h3>
      <p class="bloque__nota">Cada columna suma 100 %. Más oscuro, más peso en el presupuesto de proyectos de ese año.</p>
      <div class="tabla-scroll" style="margin-top:12px">${tablaCalor(funciones, anios, anio)}</div>
      <div class="escala-calor" aria-hidden="true">0 %
        ${["--sec-100", "--sec-200", "--sec-300", "--sec-400", "--sec-500", "--sec-600", "--sec-700"].map(c => `<span class="paso" style="background:var(${c})"></span>`).join("")}
        50 % o más</div>
      </div>

      <div class="subbloque">
        <div class="bloque__cabeza">
          <div>
            <h3>Montos por función y año</h3>
            <p class="bloque__nota">Elige las funciones que quieres ver (hasta 8 a la vez).${conGestiones ? " Las franjas sombreadas marcan cada gestión." : ""}</p>
          </div>
          <label class="campo">Monto
            <select id="f-monto">
              <option value="DEV_INV">Devengado de inversión</option>
              <option value="PIM_INV">PIM de inversión</option>
            </select>
          </label>
        </div>
        <div class="chips" id="chips-fun" role="group" aria-label="Funciones del gráfico"></div>
        <p class="aviso" id="aviso-fun" role="status"></p>
        <div class="grafico grafico--alto"><canvas id="g-fun" role="img" aria-label="Montos por función y año"></canvas></div>
      </div>
    </section>

    <!-- 5. Proyectos -->
    <section class="bloque" aria-labelledby="t-proy">
      <div class="bloque__cabeza">
        <div>
          <h2 id="t-proy">Proyectos de inversión</h2>
          <p class="bloque__nota">Proyectos con presupuesto o gasto de esta entidad en el periodo elegido. Si eliges una gestión o todos los años,
             PIA, PIM y devengado son la suma de esos años. «Devengado acumulado» es todo lo devengado en el proyecto, en cualquier año.
             «Cofinanciado»: otra entidad también registró devengado en el mismo CUI.</p>
        </div>
      </div>
      <div class="filtros" style="margin-bottom:14px">
        <label class="campo">Periodo <select id="p-periodo"></select></label>
        <label class="campo">Buscar proyecto o CUI <input type="search" id="p-buscar" placeholder="ej.: agua, 2454492"></label>
        <label class="campo">Función <select id="p-funcion"></select></label>
        <label class="check"><input type="checkbox" id="p-sinej"> Sin ejecución</label>
        <label class="check"><input type="checkbox" id="p-sinpia"> Sin PIA</label>
        <button class="boton" id="p-csv" type="button">Descargar CSV</button>
      </div>
      <div class="tabla-scroll"><table id="tabla-proy"></table></div>
      <p class="bloque__nota" id="nota-proy"></p>
    </section>

    <!-- 6. Ritmo mensual (para analistas, plegado) -->
    <details class="bloque plegable" id="d-ritmo">
      <summary><h2>Ritmo mensual de ejecución en ${anio}</h2><span class="bloque__nota">Para análisis: cómo se reparte el gasto de inversión a lo largo del año.</span></summary>
      <p class="bloque__nota">Devengado acumulado de proyectos como % del PIM de inversión. Una curva que se dispara en diciembre indica gasto concentrado a fin de año.</p>
      <ul class="leyenda" style="margin-top:12px">
        <li><i class="linea" style="background:var(--serie-1)"></i>${anio}</li>
        <li><i class="linea" style="background:var(--serie-2)"></i>Promedio de los demás años cerrados</li>
        <li><i class="punteada"></i>Ritmo parejo</li>
      </ul>
      <div class="grafico"><canvas id="g-ritmo" role="img" aria-label="Ritmo mensual de ejecución"></canvas></div>
    </details>`;

  document.getElementById("sel-anio").addEventListener("change", e => {
    location.hash = `#/entidad/${encodeURIComponent(id)}/${e.target.value}`;
  });

  graficoPIM(serie, anio, conGestiones);
  // mapa de fuentes de recursos
  mapaArbol("m-fuentes", rubros.filter(r => r.ANIO === anio).map(r => ({
    nombre: nombreRubro(r.RUBRO), valor: r.PIM, ejecutado: r.DEVENGADO
  })), "Fuentes de recursos del PIM en " + anio);

  // mapas de funciones por gestión (se pueden mostrar 1, 2 o las 3)
  if (funciones.length) arbolesPorGestion(funciones, conGestiones);
  graficoFunciones(funciones, anios, conGestiones);
  tablaProyectos(proyectos, ent, anio, conGestiones);

  // el ritmo se dibuja solo cuando se abre (un gráfico oculto no tiene tamaño)
  const det = document.getElementById("d-ritmo");
  det.addEventListener("toggle", () => {
    if (det.open && !det.dataset.listo) { graficoRitmo(mensual, serie, anio); det.dataset.listo = "1"; }
  });
}

function kpi(nombre, valor, detalle) {
  return `<div class="indicador"><dt>${nombre}</dt><dd>${valor}<small>${detalle}</small></dd></div>`;
}


/* ---- Comparación entre gestiones (solo datos principales) ---- */
function bloqueGestiones(serie) {
  const filas = GESTIONES.map(g => {
    const s = serie.filter(f => f.GESTION === g);
    if (!s.length) return null;
    const suma = c => s.reduce((t, f) => t + (f[c] || 0), 0);
    return {
      g, n: s.length,
      pimProm:   suma("PIM") / s.length,
      avance:    promedio(s.map(f => f.AVANCE)),
      avanceInv: promedio(s.map(f => f.AVANCE_INV)),
      devTotal:  suma("DEVENGADO"),
      puesto:    promedio(s.map(f => f.PUESTO)),
      parcial:   s.some(f => f.ANIO === datos.anioEnCurso)
    };
  }).filter(Boolean);

  const fila = (nombre, fn) => `<tr><th scope="row">${nombre}</th>${filas.map(x => `<td class="num">${fn(x)}</td>`).join("")}</tr>`;

  return `
    <section class="bloque" aria-labelledby="t-gest">
      <h2 id="t-gest">Comparación entre gestiones</h2>
      <p class="bloque__nota">Promedios anuales de cada periodo. El puesto es el del ranking del departamento (o del nivel de gobierno).
         ${filas.some(x => x.parcial) ? "* La gestión actual incluye el año en curso." : ""}</p>
      <div class="tabla-scroll" style="margin-top:12px">
        <table class="tabla-gestiones">
          <thead><tr><th scope="col">Indicador</th>${filas.map(x => `<th class="num" scope="col">${x.g.replace("-", "–")}${x.parcial ? "*" : ""}<span class="sub">${x.n} años</span></th>`).join("")}</tr></thead>
          <tbody>
            ${fila("PIM promedio anual", x => soles(x.pimProm))}
            ${fila("Avance promedio del presupuesto", x => pct(x.avance))}
            ${fila("Avance promedio de la inversión", x => miniBarra(x.avanceInv))}
            ${fila("Devengado total del periodo", x => soles(x.devTotal))}
            ${fila("Puesto promedio en el ranking", x => x.puesto ? fmtNum.format(x.puesto) : "–")}
          </tbody>
        </table>
      </div>
    </section>`;
}


/* ---- Mapa de calor de funciones ---- */
function tablaCalor(funciones, anios, anioSel) {
  if (!funciones.length) return `<p class="vacio">No hay datos por función para esta entidad.</p>`;

  // funciones ordenadas por su PIM de inversión total (las 12 mayores)
  const total = {};
  funciones.forEach(f => { total[f.FUNCION] = (total[f.FUNCION] || 0) + (f.PIM_INV || 0); });
  const lista = Object.keys(total).filter(k => total[k] > 0).sort((a, b) => total[b] - total[a]);
  const top = lista.slice(0, 12);
  const resto = lista.slice(12);

  const valor = (fun, a) => {
    const r = funciones.find(f => f.FUNCION === fun && f.ANIO === a);
    return r ? r.PCT_PIM_INV : null;
  };
  const valorResto = a => {
    const v = funciones.filter(f => resto.includes(f.FUNCION) && f.ANIO === a).reduce((t, f) => t + (f.PCT_PIM_INV || 0), 0);
    return v || null;
  };

  const pasos = ["--sec-100", "--sec-200", "--sec-300", "--sec-400", "--sec-500", "--sec-600", "--sec-700"];
  const celda = (v, a, fun) => {
    if (v === null || v === undefined || v === 0) return `<td class="celda ${a === anioSel ? "anio-sel" : ""}" title="${escapar(fun)}, ${a}: 0 %"></td>`;
    const i = Math.min(pasos.length - 1, Math.floor(v / 0.5 * pasos.length));
    const texto = i >= 4 ? "#ffffff" : "#16202b";
    return `<td class="celda ${a === anioSel ? "anio-sel" : ""}" style="background:var(${pasos[i]});color:${texto}"
              title="${escapar(fun)}, ${a}: ${pct(v)}">${Math.round(v * 100)}</td>`;
  };

  return `
    <table class="calor">
      <thead><tr><th scope="col">Función (%)</th>${anios.map(a => `<th class="anio ${a === anioSel ? "anio-sel" : ""}" scope="col">${a}</th>`).join("")}</tr></thead>
      <tbody>
        ${top.map(fun => `<tr><td class="funcion" title="${escapar(fun)}">${escapar(titulo(fun))}</td>${anios.map(a => celda(valor(fun, a), a, fun)).join("")}</tr>`).join("")}
        ${resto.length ? `<tr><td class="funcion">Otras ${resto.length} funciones</td>${anios.map(a => celda(valorResto(a), a, "Otras funciones")).join("")}</tr>` : ""}
      </tbody>
    </table>`;
}


/* ---------------------------------------------------------------------
   Gráficos
   --------------------------------------------------------------------- */
function opcionesBase() {
  Chart.defaults.font.family = '"Public Sans", system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = color("--tinta-2");
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    layout: { padding: { top: 4 } },
    plugins: {
      legend: { display: false },   // la leyenda va en HTML encima del gráfico
      tooltip: {
        backgroundColor: color("--superficie"), titleColor: color("--tinta"), bodyColor: color("--tinta-2"),
        borderColor: color("--linea"), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true
      }
    },
    scales: {
      x: { grid: { display: false }, border: { color: color("--linea") } },
      y: { grid: { color: color("--rejilla") }, border: { display: false }, beginAtZero: true }
    }
  };
}

// Franjas sombreadas por gestión (2015–2018 y 2023–2026 sombreadas, 2019–2022 sin sombra)
const bandasGestion = {
  id: "bandasGestion",
  beforeDatasetsDraw(chart, args, opts) {
    if (!opts || !opts.activo) return;
    const { ctx, chartArea, scales: { x } } = chart;
    const etiquetas = chart.data.labels;
    if (etiquetas.length < 2) return;
    const paso = x.getPixelForValue(1) - x.getPixelForValue(0);
    ctx.save();
    GESTIONES.forEach((g, k) => {
      const [a0, a1] = g.split("-").map(Number);
      const idx = etiquetas.map((l, i) => (l >= a0 && l <= a1) ? i : -1).filter(i => i >= 0);
      if (!idx.length) return;
      const xi = Math.max(chartArea.left, x.getPixelForValue(idx[0]) - paso / 2);
      const xf = Math.min(chartArea.right, x.getPixelForValue(idx[idx.length - 1]) + paso / 2);
      if (k % 2 === 0) {
        ctx.fillStyle = color("--banda");
        ctx.fillRect(xi, chartArea.top, xf - xi, chartArea.bottom - chartArea.top);
      }
      ctx.fillStyle = color("--tinta-3");
      ctx.font = '11px "Public Sans", system-ui, sans-serif';
      ctx.textAlign = "center";
      // en pantallas angostas el nombre se acorta ("2015–18") para no encimarse
      const ancho = xf - xi - 4;
      const textos = ["Gestión " + g.replace("-", "–"), g.replace("-", "–"), a0 + "–" + String(a1).slice(2)];
      const texto = textos.find(t => ctx.measureText(t).width <= ancho);
      if (texto) ctx.fillText(texto, (xi + xf) / 2, chartArea.top - 6);
    });
    ctx.restore();
  }
};

function conBandas(op, activo) {
  op.plugins.bandasGestion = { activo };
  if (activo) op.layout.padding.top = 20;   // espacio para el nombre de la gestión
  return op;
}

// PIM total y devengado total por año (líneas; la sombra es lo no ejecutado)
function graficoPIM(serie, anioSel, conGestiones) {
  const op = conBandas(opcionesBase(), conGestiones);
  op.scales.y.ticks = { callback: v => soles(v) };
  op.plugins.tooltip.callbacks = {
    label: c => ` ${c.dataset.label}: ${soles(c.raw)}`,
    afterBody: items => {
      const f = serie[items[0].dataIndex];
      return [`Avance del presupuesto: ${pct(f.AVANCE)}`,
              `Sin ejecutar: ${soles(Math.max(0, (f.PIM || 0) - (f.DEVENGADO || 0)))}`];
    }
  };
  const sup = color("--superficie");
  const linea = (label, campo, c, extra) => ({
    label, data: serie.map(f => f[campo]),
    borderColor: c, backgroundColor: c, borderWidth: 2, tension: 0,
    pointRadius: serie.map(f => f.ANIO === anioSel ? 6 : 3),
    pointBackgroundColor: c, pointBorderColor: sup, pointBorderWidth: 2, pointHoverRadius: 7,
    segment: { borderDash: ctx => (serie[ctx.p1DataIndex] && serie[ctx.p1DataIndex].ANIO === datos.anioEnCurso) ? [5, 4] : undefined },
    ...extra
  });
  graficos.push(new Chart(document.getElementById("g-pim"), {
    type: "line",
    data: {
      labels: serie.map(f => f.ANIO),
      datasets: [
        linea("PIM total", "PIM", color("--tinta-3")),
        linea("Devengado total", "DEVENGADO", color("--serie-1"), { fill: { target: 0, above: "transparent", below: "rgba(227, 73, 72, 0.12)" } })
      ]
    },
    options: op,
    plugins: [bandasGestion]
  }));
}

/* ---- Mapa de árbol (estilo Finviz) ----
   tamaño = parte del PIM, color = avance de ejecución (devengado / PIM) */
function nombreRubro(nombre) {
  const n = sinTildes(nombre);
  const r = RUBROS.find(x => n.includes(x.clave));
  return r ? r.nombre : titulo(nombre);
}

// Color divergente del avance (como Finviz): rojo = bajo, gris = intermedio, azul = alto
const PASOS_AVANCE = [
  { hasta: 0.50, var: "--div-r3", tinta: "#ffffff", texto: "< 50 %" },
  { hasta: 0.65, var: "--div-r2", tinta: "#ffffff", texto: "50–65" },
  { hasta: 0.75, var: "--div-r1", tinta: "#16202b", texto: "65–75" },
  { hasta: 0.85, var: "--div-0",  tinta: "#16202b", texto: "75–85" },
  { hasta: 0.92, var: "--div-b1", tinta: "#16202b", texto: "85–92" },
  { hasta: 0.97, var: "--div-b2", tinta: "#ffffff", texto: "92–97" },
  { hasta: 9,    var: "--div-b3", tinta: "#ffffff", texto: "≥ 97 %" }
];
function pasoAvance(av) {
  if (av === null || av === undefined || isNaN(av)) return null;
  return PASOS_AVANCE.find(p => av < p.hasta);
}
// Azul secuencial para la parte del gasto (0 % a 35 % o más)
const PASOS_PARTE = [
  { hasta: 0.05, var: "--sec-100", tinta: "#16202b", texto: "< 5 %" },
  { hasta: 0.10, var: "--sec-200", tinta: "#16202b", texto: "5–10" },
  { hasta: 0.15, var: "--sec-300", tinta: "#16202b", texto: "10–15" },
  { hasta: 0.20, var: "--sec-400", tinta: "#ffffff", texto: "15–20" },
  { hasta: 0.25, var: "--sec-500", tinta: "#ffffff", texto: "20–25" },
  { hasta: 0.35, var: "--sec-600", tinta: "#ffffff", texto: "25–35" },
  { hasta: 9,    var: "--sec-700", tinta: "#ffffff", texto: "≥ 35 %" }
];
function pasoParte(p) { return PASOS_PARTE.find(x => p < x.hasta); }
function leyendaParte(nota) {
  return `<div class="leyenda-div" aria-hidden="true"><span>Parte de lo gastado:</span>
    ${PASOS_PARTE.map(p => `<span class="leyenda-div__paso"><i style="background:var(${p.var})"></i>${p.texto}</span>`).join("")}
    ${nota ? `<span class="leyenda-div__nota">${nota}</span>` : ""}</div>`;
}

function leyendaAvance(nota) {
  return `<div class="leyenda-div" aria-hidden="true"><span>Avance de ejecución:</span>
    ${PASOS_AVANCE.map(p => `<span class="leyenda-div__paso"><i style="background:var(${p.var})"></i>${p.texto}</span>`).join("")}
    ${nota ? `<span class="leyenda-div__nota">${nota}</span>` : ""}</div>`;
}

// Reparte un rectángulo en recuadros con proporciones lo más cuadradas posible
function squarify(items, x, y, w, h) {
  const total = items.reduce((t, i) => t + i.valor, 0);
  const escala = (w * h) / total;
  const res = [];
  let fila = [];
  const peor = (f, lado) => {
    const s = f.reduce((t, i) => t + i.area, 0);
    const max = Math.max(...f.map(i => i.area)), min = Math.min(...f.map(i => i.area));
    return Math.max((lado * lado * max) / (s * s), (s * s) / (lado * lado * min));
  };
  const colocar = f => {
    const s = f.reduce((t, i) => t + i.area, 0);
    if (w >= h) {
      const ancho = s / h; let yy = y;
      f.forEach(i => { const alto = i.area / ancho; res.push({ ...i, x, y: yy, w: ancho, h: alto }); yy += alto; });
      x += ancho; w -= ancho;
    } else {
      const alto = s / w; let xx = x;
      f.forEach(i => { const ancho = i.area / alto; res.push({ ...i, x: xx, y, w: ancho, h: alto }); xx += ancho; });
      y += alto; h -= alto;
    }
  };
  items.map(i => ({ ...i, area: i.valor * escala })).forEach(i => {
    const lado = Math.min(w, h);
    if (!fila.length || peor([...fila, i], lado) <= peor(fila, lado)) fila.push(i);
    else { colocar(fila); fila = [i]; }
  });
  if (fila.length) colocar(fila);
  return res;
}

let tooltipArbol = null;
function mostrarTooltip(e, html) {
  if (!tooltipArbol) {
    tooltipArbol = document.createElement("div");
    tooltipArbol.className = "tooltip-arbol";
    tooltipArbol.setAttribute("role", "tooltip");
    document.body.appendChild(tooltipArbol);
  }
  tooltipArbol.innerHTML = html;
  tooltipArbol.hidden = false;
  const r = tooltipArbol.getBoundingClientRect();
  let left = e.clientX + 14, top = e.clientY + 14;
  if (left + r.width > window.innerWidth - 8) left = e.clientX - r.width - 14;
  if (top + r.height > window.innerHeight - 8) top = e.clientY - r.height - 14;
  tooltipArbol.style.left = left + "px";
  tooltipArbol.style.top = top + "px";
}
function ocultarTooltip() { if (tooltipArbol) tooltipArbol.hidden = true; }

// modo "avance": tamaño = parte del PIM, color = avance (devengado / PIM)
// modo "gasto":  tamaño = parte del devengado, color = esa misma parte (azul)
function mapaArbol(idCaja, filas, descripcion, modo = "avance") {
  const caja = document.getElementById(idCaja);
  if (!caja) return;
  const gasto = modo === "gasto";
  const items = filas.map(f => ({ ...f, tam: gasto ? f.ejecutado : f.valor }))
                     .filter(f => f.tam > 0).sort((a, b) => b.tam - a.tam);
  const total = items.reduce((t, i) => t + i.tam, 0);
  items.forEach(i => { i.parte = i.tam / total; i.avance = div(i.ejecutado, i.valor); });
  const deQue = gasto ? "del gasto" : "del PIM";
  caja.setAttribute("role", "img");
  caja.setAttribute("aria-label", descripcion + ": " +
    items.map(i => gasto ? `${i.nombre} ${pct(i.parte)} del gasto` : `${i.nombre} ${pct(i.parte)}, avance ${pct(i.avance)}`).join("; "));

  const dibujar = () => {
    const W = caja.clientWidth, H = caja.clientHeight;
    if (!W || !H || !items.length) return;
    caja.innerHTML = squarify(items.map(i => ({ ...i, valorPIM: i.valor, valor: i.tam })), 0, 0, W, H).map(t => {
      const paso = gasto ? pasoParte(t.parte) : pasoAvance(t.avance);
      const fondo = paso ? `var(${paso.var})` : "var(--neutro-dato)";
      const tinta = paso ? paso.tinta : "#16202b";
      const letra = Math.max(11, Math.min(22, Math.sqrt(t.w * t.h) / 9));
      const conTexto = t.w > 64 && t.h > 30;
      const detalle = gasto ? soles(t.ejecutado) : `${soles(t.valorPIM)} · avance ${pct(t.avance, 0)}`;
      const conDetalle = t.w > detalle.length * 6.2 + 18 && t.h > 30 + letra * 2.4;   // solo si el texto cabe
      return `<div class="tesela" tabindex="0"
          style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;background:${fondo};color:${tinta}"
          data-nombre="${escapar(t.nombre)}" data-valor="${t.valorPIM}" data-ejecutado="${t.ejecutado || 0}"
          data-parte="${t.parte}" data-avance="${t.avance ?? ""}"
          aria-label="${escapar(t.nombre)}: ${pct(t.parte)} ${deQue}">
          ${conTexto ? `<span class="tesela__nombre" style="font-size:${letra}px">${escapar(t.nombre)}</span>
                        <span class="tesela__parte" style="font-size:${Math.max(11, letra * 0.85)}px">${pct(t.parte)}</span>` : ""}
          ${conDetalle ? `<span class="tesela__detalle">${detalle}</span>` : ""}
        </div>`;
    }).join("");

    caja.querySelectorAll(".tesela").forEach(el => {
      const html = () => gasto
        ? `<strong>${el.dataset.nombre}</strong>
           <span>${pct(Number(el.dataset.parte))} de lo gastado</span>
           <span>Devengado ${soles(Number(el.dataset.ejecutado))}</span>
           <span>PIM ${soles(Number(el.dataset.valor))} (avance ${el.dataset.avance === "" ? "–" : pct(Number(el.dataset.avance))})</span>`
        : `<strong>${el.dataset.nombre}</strong>
           <span>${pct(Number(el.dataset.parte))} del PIM</span>
           <span>PIM ${soles(Number(el.dataset.valor))}</span>
           <span>Devengado ${soles(Number(el.dataset.ejecutado))}</span>
           <span>Avance ${el.dataset.avance === "" ? "–" : pct(Number(el.dataset.avance))}</span>`;
      el.addEventListener("mousemove", e => mostrarTooltip(e, html()));
      el.addEventListener("mouseleave", ocultarTooltip);
      el.addEventListener("focus", () => {
        const r = el.getBoundingClientRect();
        mostrarTooltip({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, html());
      });
      el.addEventListener("blur", ocultarTooltip);
    });
  };

  if (caja._observador) caja._observador.disconnect();
  caja._observador = new ResizeObserver(dibujar);
  caja._observador.observe(caja);
  observadores.push(caja._observador);
  dibujar();
}

// Un mapa de árbol por gestión, con la suma de sus años
function arbolesPorGestion(funciones, conGestiones) {
  const caja = document.getElementById("arboles-fun");
  const checks = [...document.querySelectorAll('input[name="g-arbol"]')];
  const selector = document.getElementById("f-arbol-fun");
  const selModo = document.getElementById("f-arbol-modo");
  const nombreG = conGestiones ? "gestión" : "periodo";

  const dibujar = () => {
    const gasto = selModo.value === "GASTO";
    const ultima = GESTIONES[GESTIONES.length - 1].replace("-", "–");
    const notaCurso = datos.anioEnCurso ? `La ${nombreG} ${ultima} incluye ${datos.anioEnCurso}, año en curso: sus montos seguirán subiendo.` : "";
    document.getElementById("nota-arbol-fun").textContent = gasto
      ? `Lo que efectivamente se gastó (devengado) en cada ${nombreG}, sumando sus años. Cada recuadro es una función; su tamaño es su parte del total gastado.`
      : `Lo programado (PIM) en cada ${nombreG}, sumando sus años. El tamaño de cada recuadro es su parte del PIM; el color, cuánto se ejecutó de esa función.`;
    document.getElementById("ley-arbol-fun").innerHTML = gasto ? leyendaParte(notaCurso) : leyendaAvance(notaCurso);
    // desconectar los mapas anteriores
    caja.querySelectorAll(".arbol").forEach(a => a._observador && a._observador.disconnect());

    const elegidas = checks.filter(c => c.checked).map(c => c.value);
    const inv = selector.value === "INV";

    const grupos = elegidas.map(g => {
      const [a0, a1] = g.split("-").map(Number);
      const suma = {};
      funciones.filter(x => x.ANIO >= a0 && x.ANIO <= a1).forEach(x => {
        const s = suma[x.FUNCION] = suma[x.FUNCION] || { valor: 0, ejecutado: 0 };
        s.valor += (inv ? x.PIM_INV : x.PIM) || 0;
        s.ejecutado += (inv ? x.DEV_INV : x.DEVENGADO) || 0;
      });
      const items = Object.entries(suma).map(([fun, v]) => ({ nombre: titulo(fun), ...v }));
      const anios = [...new Set(funciones.filter(x => x.ANIO >= a0 && x.ANIO <= a1).map(x => x.ANIO))];
      return { g, items, anios,
               total: items.reduce((t, i) => t + i.valor, 0),
               ejec: items.reduce((t, i) => t + i.ejecutado, 0) };
    });

    caja.innerHTML = grupos.map((x, i) => `
      <div class="arbol-col">
        <h3>${conGestiones ? "Gestión" : "Periodo"} ${x.g.replace("-", "–")}${x.anios.includes(datos.anioEnCurso) ? "*" : ""}</h3>
        <p class="arbol-col__dato">${gasto
          ? `Gastó <strong>${soles(x.ejec)}</strong> de un PIM de ${soles(x.total)} · ${x.anios.length} años`
          : `PIM <strong>${soles(x.total)}</strong> · avance ${pct(div(x.ejec, x.total))} · ${x.anios.length} años`}</p>
        ${(gasto ? x.ejec : x.total) > 0 ? `<div class="arbol arbol--alto" id="m-fun-${i}"></div>` : `<p class="vacio">Sin datos en este periodo.</p>`}
      </div>`).join("");

    grupos.forEach((x, i) => {
      if ((gasto ? x.ejec : x.total) > 0)
        mapaArbol("m-fun-" + i, x.items, `${gasto ? "Reparto del gasto" : "Reparto del PIM"} por función, ${x.g}`, gasto ? "gasto" : "avance");
    });
  };

  checks.forEach(c => c.addEventListener("change", () => {
    if (!checks.some(x => x.checked)) c.checked = true;   // siempre queda al menos una
    dibujar();
  }));
  selector.addEventListener("change", dibujar);
  selModo.addEventListener("change", dibujar);
  dibujar();
}

// Líneas por función, con funciones que se pueden quitar o agregar
function graficoFunciones(funciones, anios, conGestiones) {
  const caja = document.getElementById("chips-fun");
  const aviso = document.getElementById("aviso-fun");
  if (!funciones.length) { caja.innerHTML = `<p class="vacio">No hay datos por función.</p>`; return; }

  let campo = "DEV_INV";
  const total = {};
  funciones.forEach(f => { total[f.FUNCION] = (total[f.FUNCION] || 0) + (f.PIM_INV || 0); });
  const lista = Object.keys(total).filter(k => total[k] > 0).sort((a, b) => total[b] - total[a]);

  // cada función activa ocupa un "color" (1 a 8) que conserva mientras esté activa
  const activas = new Map();
  lista.slice(0, 5).forEach((fun, i) => activas.set(fun, i + 1));
  let grafico = null;

  const dibujarChips = () => {
    caja.innerHTML = lista.map(fun => {
      const slot = activas.get(fun);
      return `<button type="button" class="chip" aria-pressed="${slot ? "true" : "false"}" data-fun="${escapar(fun)}">
                <i style="background:${slot ? `var(--cat-${slot})` : "transparent"}"></i>${escapar(titulo(fun))}</button>`;
    }).join("");
    caja.querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => {
      const fun = b.dataset.fun;
      aviso.textContent = "";
      if (activas.has(fun)) {
        activas.delete(fun);
      } else {
        const libre = [1, 2, 3, 4, 5, 6, 7, 8].find(s => ![...activas.values()].includes(s));
        if (!libre) { aviso.textContent = "Puedes ver hasta 8 funciones a la vez. Quita una para agregar otra."; return; }
        activas.set(fun, libre);
      }
      dibujarChips();
      dibujarGrafico();
    }));
  };

  const dibujarGrafico = () => {
    if (grafico) { grafico.destroy(); graficos = graficos.filter(g => g !== grafico); }
    const op = conBandas(opcionesBase(), conGestiones);
    op.scales.y.ticks = { callback: v => soles(v) };
    op.plugins.tooltip.itemSort = (a, b) => (b.raw || 0) - (a.raw || 0);
    op.plugins.tooltip.callbacks = { label: c => ` ${c.dataset.label}: ${soles(c.raw)}` };
    const sup = color("--superficie");
    grafico = new Chart(document.getElementById("g-fun"), {
      type: "line",
      data: {
        labels: anios,
        datasets: [...activas.entries()].map(([fun, slot]) => {
          const c = color("--cat-" + slot);
          return {
            label: titulo(fun),
            data: anios.map(a => { const r = funciones.find(x => x.FUNCION === fun && x.ANIO === a); return r ? r[campo] : 0; }),
            borderColor: c, backgroundColor: c, borderWidth: 2, tension: 0,
            pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: c, pointBorderColor: sup, pointBorderWidth: 2
          };
        })
      },
      options: op,
      plugins: [bandasGestion]
    });
    graficos.push(grafico);
  };

  document.getElementById("f-monto").addEventListener("change", e => { campo = e.target.value; dibujarGrafico(); });
  dibujarChips();
  dibujarGrafico();
}

// Ritmo mensual (se dibuja al abrir su sección)
function graficoRitmo(mensual, serie, anioSel) {
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
  const pimDe = a => (serie.find(f => f.ANIO === a) || {}).PIM_INV || 0;

  const curva = a => {
    const pim = pimDe(a);
    if (!pim) return null;
    const filas = mensual.filter(m => m.ANIO === a);
    if (!filas.length) return null;
    const ultimoMes = Math.max(...filas.map(m => m.MES));
    let acum = 0;
    return meses.map((_, i) => {
      const m = filas.find(x => x.MES === i + 1);
      if (m) acum = m.DEV_INV_ACUM;
      return i + 1 <= ultimoMes ? acum / pim : null;
    });
  };

  const sel = curva(anioSel);
  const otros = serie.map(f => f.ANIO).filter(a => a !== anioSel && a !== datos.anioEnCurso).map(curva).filter(Boolean);
  const prom = otros.length ? meses.map((_, i) => otros.reduce((t, c) => t + (c[i] || 0), 0) / otros.length) : null;

  const op = opcionesBase();
  op.scales.y.ticks = { callback: v => Math.round(v * 100) + " %" };
  op.scales.y.suggestedMax = 1;
  op.plugins.tooltip.callbacks = { label: c => c.raw === null ? null : ` ${c.dataset.label}: ${pct(c.raw)}` };

  const s1 = color("--serie-1"), s2 = color("--serie-2");
  const ds = [{ label: String(anioSel), data: sel || [], borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0 }];
  if (prom) ds.push({ label: "Promedio de otros años", data: prom, borderColor: s2, backgroundColor: s2, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0 });
  ds.push({ label: "Ritmo parejo", data: meses.map((_, i) => (i + 1) / 12), borderColor: color("--tinta-3"), borderWidth: 1, borderDash: [4, 4], pointRadius: 0, pointHoverRadius: 0 });

  graficos.push(new Chart(document.getElementById("g-ritmo"), {
    type: "line", data: { labels: meses, datasets: ds }, options: op
  }));
}


/* ---------------------------------------------------------------------
   Tabla de proyectos: periodo (año, gestión o todos), función y otros filtros
   --------------------------------------------------------------------- */
function tablaProyectos(todos, ent, anio, conGestiones) {
  const est = { periodo: "A:" + anio, q: "", funcion: "", sinEj: false, sinPia: false, orden: "DEVENGADO", dir: "desc", mostrar: 50 };
  const tabla = document.getElementById("tabla-proy");
  const nota = document.getElementById("nota-proy");
  const titulo2 = document.getElementById("t-proy");

  // devengado acumulado de cada CUI en todos los años
  const acumulado = {};
  todos.forEach(p => { acumulado[p.CUI] = (acumulado[p.CUI] || 0) + (p.DEVENGADO || 0); });

  // opciones de periodo: años, gestiones y todos los años
  const anios = [...new Set(todos.map(p => p.ANIO))].sort((a, b) => b - a);
  const nombreG = conGestiones ? "Gestión" : "Periodo";
  document.getElementById("p-periodo").innerHTML = `
    <optgroup label="Por año">${anios.map(a => `<option value="A:${a}" ${a === anio ? "selected" : ""}>${a}${a === datos.anioEnCurso ? " (en curso)" : ""}</option>`).join("")}</optgroup>
    <optgroup label="Por ${nombreG.toLowerCase()}">${GESTIONES.slice().reverse().map(g => `<option value="G:${g}">${nombreG} ${g.replace("-", "–")}</option>`).join("")}</optgroup>
    <option value="T">Todos los años (${anios[anios.length - 1]}–${anios[0]})</option>`;

  // proyectos del periodo, sumando sus años (una fila por CUI)
  let delPeriodo = [];
  const calcularPeriodo = () => {
    const [tipo, valor] = est.periodo.split(":");
    let a0 = -Infinity, a1 = Infinity, texto = "en todos los años";
    if (tipo === "A") { a0 = a1 = Number(valor); texto = "en " + valor; }
    if (tipo === "G") { [a0, a1] = valor.split("-").map(Number); texto = `en la ${nombreG.toLowerCase()} ${valor.replace("-", "–")}`; }
    titulo2.textContent = "Proyectos de inversión " + texto;

    const porCUI = {};
    todos.filter(p => p.ANIO >= a0 && p.ANIO <= a1).sort((a, b) => b.ANIO - a.ANIO).forEach(p => {
      const r = porCUI[p.CUI] = porCUI[p.CUI] ||
        { CUI: p.CUI, NOMBRE: p.NOMBRE, FUNCION: p.FUNCION, PIA: 0, PIM: 0, DEVENGADO: 0, ANIOS: [] };  // nombre del año más reciente
      r.PIA += p.PIA || 0; r.PIM += p.PIM || 0; r.DEVENGADO += p.DEVENGADO || 0;
      r.ANIOS.push(p.ANIO);
    });
    delPeriodo = Object.values(porCUI).map(r => ({
      ...r,
      AVANCE: div(r.DEVENGADO, r.PIM),
      SIN_PIA: r.PIA === 0 && r.PIM > 0,
      SIN_EJECUCION: r.PIM > 0 && r.DEVENGADO === 0,
      DEV_ACUM: acumulado[r.CUI] || 0
    }));

    // el filtro de función solo ofrece las funciones del periodo
    const funs = [...new Set(delPeriodo.map(p => p.FUNCION))].filter(Boolean).sort();
    if (!funs.includes(est.funcion)) est.funcion = "";
    document.getElementById("p-funcion").innerHTML = opciones(funs, est.funcion, "Todas las funciones");
  };

  const filtrar = () => {
    const q = sinTildes(est.q.trim());
    let f = delPeriodo.filter(p =>
      (!q || sinTildes(p.NOMBRE).includes(q) || String(p.CUI).includes(q)) &&
      (!est.funcion || p.FUNCION === est.funcion) &&
      (!est.sinEj || p.SIN_EJECUCION) && (!est.sinPia || p.SIN_PIA));
    const s = est.dir === "asc" ? 1 : -1;
    f.sort((a, b) => {
      const va = a[est.orden], vb = b[est.orden];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (va > vb ? 1 : va < vb ? -1 : 0) * s;
    });
    return f;
  };

  const dibujar = () => {
    const filas = filtrar();
    const varios = !est.periodo.startsWith("A:");
    const cab = (c, t, num = true) =>
      `<th class="${num ? "num" : ""}" scope="col"><button data-col="${c}" ${est.orden === c ? `data-orden="${est.dir}"` : "data-orden"}>${t}</button></th>`;
    tabla.innerHTML = `
      <thead><tr>
        ${cab("CUI", "CUI", false)}${cab("NOMBRE", "Proyecto", false)}${cab("FUNCION", "Función", false)}
        ${cab("PIA", "PIA")}${cab("PIM", "PIM")}${cab("DEVENGADO", varios ? "Devengado del periodo" : "Devengado del año")}${cab("AVANCE", "Avance")}
        ${cab("DEV_ACUM", "Devengado acumulado")}
      </tr></thead>
      <tbody>
        ${filas.slice(0, est.mostrar).map(p => {
          const cofin = / \(cofinanciado\)$/.test(p.NOMBRE);
          const nombre = p.NOMBRE.replace(/ \(cofinanciado\)$/, "");
          const anios = p.ANIOS.slice().sort((a, b) => a - b);
          return `<tr>
            <td>${p.CUI}</td>
            <td class="col-proyecto">${escapar(nombre)}
              ${varios ? `<span class="sub">Con presupuesto en ${anios.length <= 4 ? anios.join(", ") : anios[0] + "–" + anios[anios.length - 1] + " (" + anios.length + " años)"}</span>` : ""}
              ${cofin ? `<span class="etiqueta etiqueta--cofin">Cofinanciado</span>` : ""}
              ${p.SIN_EJECUCION ? `<span class="etiqueta etiqueta--critico">Sin ejecución</span>` : ""}
              ${p.SIN_PIA ? `<span class="etiqueta etiqueta--alerta">Sin PIA</span>` : ""}
            </td>
            <td>${escapar(titulo(p.FUNCION))}</td>
            <td class="num">${soles(p.PIA)}</td>
            <td class="num">${soles(p.PIM)}</td>
            <td class="num"><strong>${soles(p.DEVENGADO)}</strong></td>
            <td class="num">${miniBarra(p.AVANCE)}</td>
            <td class="num">${soles(p.DEV_ACUM)}</td>
          </tr>`;
        }).join("") || `<tr><td colspan="8" class="vacio">Ningún proyecto cumple esos filtros.</td></tr>`}
      </tbody>`;

    const pim = filas.reduce((t, p) => t + (p.PIM || 0), 0);
    const dev = filas.reduce((t, p) => t + (p.DEVENGADO || 0), 0);
    nota.innerHTML = `<strong>Devengado total: ${soles(dev)}</strong> de un PIM de ${soles(pim)} (avance ${pct(div(dev, pim))}),
      en ${filas.length} proyectos. Mostrando ${Math.min(est.mostrar, filas.length)}.
      ${filas.length > est.mostrar ? `<button class="boton" id="p-mas" type="button">Mostrar 50 más</button>` : ""}`;

    tabla.querySelectorAll("th button").forEach(b => b.addEventListener("click", () => {
      const c = b.dataset.col;
      est.dir = (est.orden === c) ? (est.dir === "asc" ? "desc" : "asc") : (["CUI", "NOMBRE", "FUNCION"].includes(c) ? "asc" : "desc");
      est.orden = c;
      dibujar();
    }));
    const mas = document.getElementById("p-mas");
    if (mas) mas.addEventListener("click", () => { est.mostrar += 50; dibujar(); });
  };

  document.getElementById("p-periodo").addEventListener("change", e => { est.periodo = e.target.value; est.mostrar = 50; calcularPeriodo(); dibujar(); });
  document.getElementById("p-buscar").addEventListener("input", e => { est.q = e.target.value; est.mostrar = 50; dibujar(); });
  document.getElementById("p-funcion").addEventListener("change", e => { est.funcion = e.target.value; est.mostrar = 50; dibujar(); });
  document.getElementById("p-sinej").addEventListener("change", e => { est.sinEj = e.target.checked; dibujar(); });
  document.getElementById("p-sinpia").addEventListener("change", e => { est.sinPia = e.target.checked; dibujar(); });
  document.getElementById("p-csv").addEventListener("click", () =>
    descargarCSV(filtrar().map(p => ({ ENTIDAD: ent.NOMBRE, PERIODO: est.periodo.replace(/^.:/, "") || "todos",
      CUI: p.CUI, NOMBRE: p.NOMBRE, FUNCION: p.FUNCION, PIA: p.PIA, PIM: p.PIM, DEVENGADO: p.DEVENGADO,
      AVANCE: p.AVANCE, DEV_ACUMULADO: p.DEV_ACUM, SIN_PIA: p.SIN_PIA, SIN_EJECUCION: p.SIN_EJECUCION })),
      `proyectos_${ent.ID}_${est.periodo.replace(/^.:/, "") || "todos"}.csv`));

  calcularPeriodo();
  dibujar();
}


/* ---------------------------------------------------------------------
   Metodología
   --------------------------------------------------------------------- */
function paginaMetodologia() {
  document.title = "Metodología – Inversión pública al detalle";
  app.innerHTML = `
    <article class="texto">
      <h1>Metodología</h1>
      <p>Los datos vienen de los archivos de Presupuesto y Ejecución del Gasto de Datos Abiertos del MEF,
         los mismos que muestra la Consulta Amigable. Se procesan en R y se publican aquí como archivos JSON.
         Todos los montos están en soles corrientes, sin ajustar por inflación.</p>

      <h2>Entidades</h2>
      <p>Las municipalidades se identifican por su unidad ejecutora (SEC_EJEC). Los gobiernos regionales y las entidades
         nacionales se agrupan por pliego. La ubicación es la de la entidad, no la del lugar donde se ejecuta cada gasto.</p>

      <h2>Indicadores</h2>
      <dl>
        <dt>PIA y PIM</dt><dd>Presupuesto institucional de apertura y modificado (vigente al cierre o a la fecha de corte).</dd>
        <dt>Devengado</dt><dd>Gasto reconocido como obligación de pago; es la medida habitual de ejecución.</dd>
        <dt>Avance total</dt><dd>Devengado entre PIM de todo el presupuesto.</dd>
        <dt>Avance de la inversión</dt><dd>Devengado entre PIM, solo de los proyectos de inversión.</dd>
        <dt>Mapas de árbol (fuentes y funciones)</dt><dd>Cada recuadro es una fuente de recursos (rubro) o una función. En «gasto efectivo», su tamaño es su parte de lo devengado: permite decir, por ejemplo, que una gestión destinó el 12 % de lo que gastó a educación. En «lo programado», su tamaño es su parte del PIM y su color, el avance de ejecución (devengado / PIM) de esa parte.</dd>
        <dt>Ranking de la página de inicio</dt><dd>Orden por avance de la inversión entre las entidades que se muestran con los filtros elegidos
            (todo el nivel de gobierno, un departamento o una provincia). Los empates comparten puesto.</dd>
        <dt>Puesto en la ficha de la entidad</dt><dd>Las municipalidades se comparan con las de su departamento; los gobiernos regionales
            y las entidades nacionales, con las de su nivel.</dd>
        <dt>Comparación entre gestiones</dt><dd>Periodos 2015–2018, 2019–2022 y 2023–2026. Los avances y el puesto son promedios
            de los años de cada periodo; el devengado es la suma del periodo.</dd>
      </dl>

      <h2>Proyectos</h2>
      <ul>
        <li>Se excluye el código 2999999, que no corresponde a un proyecto específico.</li>
        <li><strong>Sin PIA:</strong> el proyecto tiene PIM en el año pero no tenía presupuesto inicial.</li>
        <li><strong>Sin ejecución:</strong> el proyecto tiene PIM en el año y su devengado es cero.</li>
        <li><strong>Por gestión o todos los años:</strong> PIA, PIM y devengado son la suma de los años elegidos; «sin PIA» y «sin ejecución» se evalúan sobre esa suma.</li>
        <li><strong>Devengado acumulado:</strong> todo lo devengado por la entidad en el proyecto, en cualquier año.</li>
        <li><strong>Cofinanciado:</strong> dos o más entidades registraron devengado en el mismo CUI en algún año.</li>
      </ul>

      <h2>Límites</h2>
      <ul>
        <li>El devengado muestra quién ejecuta el gasto, no necesariamente quién lo financia.</li>
        <li>No se ven las modificaciones mensuales del PIM, solo el PIM a la fecha.</li>
        <li>El avance físico y la etapa de cada obra no están en estos datos; vienen del Banco de Inversiones (SSI).</li>
        <li>El año ${datos.anioEnCurso || "en curso"} está incompleto: sus avances seguirán cambiando hasta diciembre.</li>
      </ul>
    </article>`;
}


iniciar();