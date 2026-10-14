import { CanarioError } from '../../../nucleo/parse/errores.ts'
import { pedir, pedirBytes } from '../../../nucleo/http.ts'
import { enlaceProvidencia } from './enlaces.ts'

export type TextoProvidencia = { texto: string; paginas: number; urlVisor: string; fichero: string }

/**
 * Texto de una providencia, por el token que emite el buscador.
 *
 * El camino es de tres saltos y lo publica el propio portal: el buscador emite
 * `VerProvidencia.aspx?tokenDocumento=<JWT>`, esa página genera una URL firmada
 * (SAS de Azure, solo lectura y una hora de vida) y ahí está el PDF. La ficha
 * del proceso, que es a donde se enlazaba antes, pide una verificación
 * anti-robot; esta ruta no pide nada.
 *
 * El token caduca en una hora, así que no es citable: para citar sigue valiendo
 * el radicado. Si caducó, se vuelve a buscar y sale uno nuevo.
 */
export async function obtenerTexto(token: string): Promise<TextoProvidencia | null> {
  const urlVisor = enlaceProvidencia(token)
  const r = await pedir(urlVisor, 90_000)
  if (r.status !== 200) return null

  // El visor recibe su configuración en un `init` con JSON literal; ahí viaja la
  // URL firmada. Se lee de ahí porque la URL del blob que aparece suelta en el
  // HTML va SIN firma y responde 409 PublicAccessNotPermitted.
  const m = r.cuerpo.match(/VerProvidenciaViewer\.init\([^,]+,\s*(\{[\s\S]*?\})\s*\)/)
  if (!m) return null
  let cfg: { url?: string; filename?: string; forceZip?: boolean }
  try {
    cfg = JSON.parse(m[1]!.replace(/\\u0026/g, '&')) as typeof cfg
  } catch {
    throw new CanarioError('el visor de SAMAI cambió el formato de su configuración')
  }
  if (!cfg.url) return null

  const fichero = cfg.filename ?? ''
  // Algunas actuaciones se sirven comprimidas o en otro formato. Decirlo vale
  // más que devolver basura: el enlace del visor sigue sirviendo para abrirlas.
  if (cfg.forceZip || !/\.pdf($|\?)/i.test(cfg.url)) {
    return { texto: '', paginas: 0, urlVisor, fichero }
  }

  const pdf = await pedirBytes(cfg.url, 120_000)
  if (pdf.status !== 200) return null

  // El extractor se carga en diferido: solo esta herramienta lo necesita y son
  // ~200 KB del bundle que ninguna otra consulta debería pagar al arrancar.
  //
  // Es `unpdf` —pdf.js— y no @llamaindex/liteparse, que era el doble de rápido
  // (417 ms frente a 884 en la misma sentencia de 36 páginas) y se descartó
  // igual: trae un binario NATIVO por plataforma, así que el .mcpb, que viaja
  // sin node_modules, respondía "Failed to load native module for win32-x64".
  // Comprobado ejecutando el servidor compilado en un directorio limpio. Este
  // proyecto ya había descartado antes una dependencia nativa, por lo mismo.
  const { extractText, getDocumentProxy } = await import('unpdf')
  const doc = await getDocumentProxy(new Uint8Array(pdf.datos))
  const { totalPages, text } = await extractText(doc, { mergePages: true })
  const texto = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return { texto, paginas: totalPages, urlVisor, fichero }
}
