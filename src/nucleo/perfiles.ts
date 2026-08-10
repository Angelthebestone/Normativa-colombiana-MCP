/**
 * Perfiles de la versión 2.0: consultas predigeridas por sector.
 *
 * Un perfil empaqueta la pregunta que alguien haría por sector —«normas
 * laborales sobre X», «normativa tributaria de X»— con la fuente que mejor la
 * responde y la forma de presentarla. Nada de esto es una fuente nueva: los
 * cinco apoyan las herramientas que ya existen (Gestor, DIAN, ANLA, Consejo de
 * Estado y CREG) y se limitan a escoger argumentos y a dar formato de líneas al
 * resultado.
 *
 * `advertencia` es obligatoria por la misma razón que en las fuentes
 * sectoriales: cada una de estas miente por omisión (el Gestor no publica
 * vigencia, Eureka clasifica en vez de legislar…) y un vacío sin aviso se
 * leería como «no existe nada sobre esto».
 */
import * as anla from '../fuentes/anla.ts'
import * as consejo from '../fuentes/jurisprudencia/consejoestado.ts'
import * as creg from '../fuentes/creg.ts'
import * as gestor from '../fuentes/gestor.ts'
import * as dian from '../fuentes/normograma.ts'

export type Perfil = {
  id: string
  nombre: string
  sector: string
  /** Qué NO cubre la fuente o a qué induce a error. Se emite siempre. */
  advertencia: string
  /** Devuelve el resultado ya formateado en líneas, no objetos. */
  consultar(texto: string, limite: number): Promise<string>
}

/** Se rellena en `registrarPerfil()`; el orden de este mapa es el que ve quien consulta. */
const REGISTRO = new Map<string, Perfil>()

export function registrarPerfil(...perfiles: Perfil[]): void {
  for (const p of perfiles) REGISTRO.set(p.id, p)
}

export function perfiles(): Perfil[] {
  return [...REGISTRO.values()]
}

export function perfil(id: string): Perfil | undefined {
  return REGISTRO.get(id)
}

/** Cada resultado en dos líneas: «- encabezado» y la segunda indentada. */
function lineas(pares: [string, string][]): string {
  return pares.map(([a, b]) => `- ${a}\n  ${b}`).join('\n')
}

async function consultarLaboral(texto: string, limite: number): Promise<string> {
  // El Gestor no acepta `limite`: devuelve todo y se recorta aquí.
  const r = await gestor.buscar({ palabras: texto })
  return lineas(r.items.slice(0, limite).map((i) => [i.titulo, i.url] as [string, string]))
}

async function consultarTributario(texto: string, limite: number): Promise<string> {
  const r = await dian.buscar(texto, limite, 0)
  return lineas(
    r.items.map(
      (d) =>
        [
          [d.nombre, d.tipo ? `(${d.tipo})` : '', d.epigrafe].filter(Boolean).join(' '),
          d.url,
        ] as [string, string],
    ),
  )
}

async function consultarAmbiental(texto: string, limite: number): Promise<string> {
  // Eureka no tiene buscador propio: se baja la sección y se filtra en memoria.
  const r = await anla.listar('leyes', 0)
  return lineas(anla.filtrar(r.items, texto).slice(0, limite).map((x) => [x.titulo, x.url] as [string, string]))
}

async function consultarContratacion(texto: string, limite: number): Promise<string> {
  const r = await consejo.buscar(texto, limite, 1)
  return lineas(r.items.map((p) => [p.radicado, p.url] as [string, string]))
}

async function consultarEnergia(texto: string, limite: number): Promise<string> {
  const r = await creg.buscar('vigentes', texto, limite, undefined)
  return lineas(
    r.items.map((x) => [`Resolución CREG ${x.numero} de ${x.anio}`, x.epigrafe] as [string, string]),
  )
}

// --- perfiles registrados (orden de presentación) -------------------------

const LABORAL: Perfil = {
  id: 'laboral',
  nombre: 'Normativa laboral',
  sector: 'Derecho laboral y seguridad social',
  advertencia: 'El Gestor no publica vigencia; para el estado de una norma usa resolver_cita.',
  consultar: consultarLaboral,
}

const TRIBUTARIO: Perfil = {
  id: 'tributario',
  nombre: 'Normativa tributaria',
  sector: 'Tributario, aduanero y cambiario (DIAN)',
  advertencia: 'La primera búsqueda de la DIAN tarda unos 20 s: el buscador devuelve el catálogo completo.',
  consultar: consultarTributario,
}

const AMBIENTAL: Perfil = {
  id: 'ambiental',
  nombre: 'Licenciamiento ambiental',
  sector: 'Licenciamiento y normativa ambiental (ANLA)',
  advertencia: 'Eureka clasifica la normativa nacional por temas; no es normativa propia de la ANLA.',
  consultar: consultarAmbiental,
}

const CONTRATACION_ESTATAL: Perfil = {
  id: 'contratacion_estatal',
  nombre: 'Contratación estatal',
  sector: 'Contratación estatal (Consejo de Estado y Gestor)',
  advertencia: 'Los tokens de SAMAI caducan en una hora: cita por radicado, no por enlace.',
  consultar: consultarContratacion,
}

const ENERGIA: Perfil = {
  id: 'energia',
  nombre: 'Energía y gas',
  sector: 'Energía y gas (CREG, UPME, ANH)',
  advertencia: 'El estado (vigente/derogada) es según la compilación de la CREG, no un campo de vigencia.',
  consultar: consultarEnergia,
}

registrarPerfil(LABORAL, TRIBUTARIO, AMBIENTAL, CONTRATACION_ESTATAL, ENERGIA)
