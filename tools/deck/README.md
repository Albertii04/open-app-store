# De CAD a render con IA — Workshop Concep

Slide deck para la intervención en el workshop de Concep (14 mayo 2026).
App **Vue 3 + Vite**, dark canvas, transiciones GSAP, modo presentador con
sincronización entre pantallas. Inspirado en el design system de Primlux.

El deck está en **`deck/`**. Es la única presentación del repo (las dos versiones
antiguas — un HTML de un solo archivo y un build de Slidev — se retiraron).

## Presentar

```bash
cd deck
pnpm dev
```

Se abren dos pantallas en el mismo servidor:

- **Audiencia (proyector):** `http://localhost:5173/`
  Teclado bloqueado a propósito — solo `F` (pantalla completa) y `Esc`.
- **Presentador (tu portátil):** `http://localhost:5173/?p`
  Slide actual + preview de la siguiente, notas, rejilla para saltar, cronómetro
  y reloj, y los controles de los sub-estados. Tiene un botón para abrir la
  ventana de audiencia.

Las dos ventanas se sincronizan solas (mismo navegador/perfil). Pon la de
audiencia en el proyector y conduce todo desde la de presentador.

Atajos: `F` pantalla completa · `Esc` salir · en presentador `T` cronómetro,
`R` reset. Saltar a una slide concreta: añade `#N` a la URL.

## Antes de presentar

Abre el deck **una vez con internet** para que el navegador cachee la fuente
Inter. Después funciona offline (la fuente de respaldo es Helvetica Neue / Arial,
ya configurada).

## Estructura

```
concep-workshop/
├── README.md             # esto
├── CLAUDE.md             # contexto para Claude Code
├── images/               # todas las capturas y renders (compartidas)
└── deck/                 # la app Vue
    └── src/
        ├── slidesManifest.ts   # orden de las slides (= orden de reproducción)
        ├── App.vue             # deck de audiencia
        ├── Presenter.vue       # consola de presentador
        └── slides/             # una .vue por slide
```

Las imágenes viven en `images/` (en la raíz). `deck/public/images` es un symlink
a esa carpeta, así que añades capturas en `images/` y ya está.

## Las slides

El orden lo manda `deck/src/slidesManifest.ts`. Para reordenar o quitar una
slide, edita ese array — nada más depende de las posiciones. 19 slides:

```
01  Portada                         11  Zoom panel D5
02  El problema                     12  Referencias del cliente
03  El flujo                        13  Estilo D5
04  Paso 1 — CAD                    14  Prompt — instrucción a la IA
05  Paso 2 — SketchUp               15  Ajustes
06  Librería (3 sub-estados)        16  Renderizando
07  Antes / Después                 17  Render final · 4 variantes
08  Modelo listo                    18  Lo que cambia
09  Zoom D5 Lite                    19  Cierre
10  D5 panel abierto
```

A ~60s por slide encaja en ~20 min.

## Slides interactivas

Algunas tienen estado interno (wipe antes/después arrastrable, revelado por
pasos, ciclo de 4 variantes de render). Ese estado se sincroniza presentador ↔
audiencia, y se controla desde la consola de presentador:

- **El flujo** — recorre los 4 pasos
- **Paso 2 — SketchUp** — zoom al icono C cian
- **Librería** — Familias → Modelos → Variantes
- **Render final** — cicla las 4 variantes y arrastra el wipe antes/después

## Tocar algo de última hora

- **Tu nombre / email** — `src/slides/Slide01_Cover.vue` y `Slide19_Close.vue`
- **Frase final** — `Slide19_Close.vue` y la nota en `slidesManifest.ts`
- **Notas de orador** — campo `notes` de cada entrada en `slidesManifest.ts`
- **Una imagen** — sustitúyela en `images/` con el mismo nombre

## Build estático (para llevar en USB)

```bash
cd deck
pnpm build      # genera deck/dist/
pnpm preview    # sírvelo para comprobar
```

## Para Claude Code

`CLAUDE.md` tiene todo el contexto: arquitectura, design system, tono,
convenciones, decisiones pendientes. Pásalo al inicio de la sesión.
