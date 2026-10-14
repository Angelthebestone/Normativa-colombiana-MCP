/**
 * Referencias a documentos que el texto manda consultar y que NO son normas:
 * manuales, protocolos, guías, cartillas, instructivos, anexos. Ninguna fuente
 * de esta extensión los tiene, así que callarlas es la peor respuesta posible:
 * quien pregunta por el punto que decide el caso recibe el artículo, no
 * encuentra la regla, y concluye que el artículo no dice nada.
 *
 * Medido el 2026-09-16 en el Decreto 1066 de 2015, artículo 2.4.1.2.44, numeral
 * 1.16 (id 76835, https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=76835):
 * «Las demás establecidas en el Manual de Uso, Manejo y Recomendaciones de
 * Medidas de Prevención y Protección, o el documento que haga sus veces». Ese
 * manual decidía el punto central de un caso real y no está en ninguna fuente.
 *
 * La palabra clave va en mayúscula inicial a propósito: así se lee como el
 * título de un documento («el Manual de Uso…») y no como una descripción
 * («el manual de funciones aplicable»), que no nombra nada que consultar.
 */
const DOCUMENTO_EXTERNO = /\b(?:Manual|Protocolo|Gu[íi]a|Cartilla|Instructivo|Anexo)\b[^.;\n]{0,110}/g

export function documentosRemitidos(texto: string): string[] {
  const plano = texto.replace(/\s+/g, ' ')
  const vistos = new Set<string>()
  for (const m of plano.matchAll(DOCUMENTO_EXTERNO)) {
    const doc = m[0].replace(/\s+/g, ' ').replace(/[,;:]$/, '').trim()
    // Un tramo que además nombra una norma no es el caso que aquí falta: eso
    // se resuelve con `resolver_cita`.
    if (/\b(?:Ley|Decreto|Resoluci[óo]n|Acuerdo|Circular)\s*\d/i.test(doc)) continue
    if (doc.length < 12) continue
    vistos.add(doc.length > 120 ? `${doc.slice(0, 119)}…` : doc)
  }
  return [...vistos]
}

/**
 * Erratas verificadas en el texto que sirven las fuentes, medidas una a una.
 * Medido el 2026-09-16 en la SU-371/21 (relatoría de la Corte Constitucional,
 * https://www.corteconstitucional.gov.co/relatoria/2021/SU371-21.htm): «tener
 * como validas tales grabaciones» (por «válidas») e «intensión» (por
 * «intención»). El texto se devuelve literal —corregirlo en silencio rompería
 * la correspondencia con la fuente—, así que lo que hay que hacer es declararlo.
 *
 * ponytail: la lista es corta y envejece: cubre solo las erratas comprobadas a
 * mano. El techo es una errata que nadie haya verificado antes; el salto, si
 * algún día importa, es un corrector ortográfico sobre el fragmento, no ampliar
 * la lista a ojo.
 */
const ERRATAS_VERIFICADAS = ['validas', 'intensión']

/**
 * Lo que el fragmento devuelto puede hacer creer y no es cierto. Hoy son tres
 * familias y el nombre solo nombra la primera: la vigencia incrustada en el
 * articulado, las remisiones a documentos que ninguna fuente tiene y las
 * erratas de la fuente que se transcriben sin corregir. Las tres comparten el
 * mismo motivo para vivir aquí —el fragmento viaja sin su contexto y quien lo
 * lee no puede saberlo—, y las tres viajan juntas porque todas las fuentes
 * llaman a esta función al devolver texto.
 *
 * La vigencia no es un campo: va incrustada en el articulado. El Decreto 1083
 * trae 155 "Modificado por" y 17 "Derogado". Citar un artículo derogado como
 * vigente es el error caro, así que se advierte sobre el fragmento devuelto.
 */
export function advertenciasVigencia(texto: string): string[] {
  const avisos: string[] = []
  const derogado = (texto.match(/\bDerogad[oa]\b/gi) ?? []).length
  const modificado = (texto.match(/\bModificad[oa] por\b/gi) ?? []).length
  // Las otras dos formas de anotar una reforma, las mismas que reconoce
  // `historial`. Sin ellas, el artículo 6 de la Ley 1221 de 2008 —declarado
  // exequible de forma condicionada e inhibida en un numeral, y adicionado por
  // la Ley 2466 de 2025— se mostraba sin una sola advertencia.
  const reformado = (texto.match(/\(\s*(?:Adiciona|Modifica|Deroga|Sustituye|Subroga|Corrige)\b[^)\n]{0,160}\)/gi) ?? []).length
  const constitucional = (texto.match(/\bDeclarad[oa]s?\b(?=[^\n]{0,160}\b(?:C|T|SU)-\s?\d)/gi) ?? []).length
  if (derogado) avisos.push(`El texto mostrado contiene ${derogado} marca(s) de derogatoria. Verifica si el aparte que te interesa sigue vigente.`)
  if (modificado) avisos.push(`Contiene ${modificado} nota(s) de "Modificado por". El texto original pudo haber cambiado.`)
  if (reformado) avisos.push(`Contiene ${reformado} nota(s) del portal en activa ("Adiciona…", "Deroga…"). Úsalas con obtener_documento con fuente="gestor" e historial=true.`)
  if (constitucional) {
    avisos.push(
      `Contiene ${constitucional} nota(s) de control constitucional (exequibilidad condicionada, inexequibilidad o ` +
        `inhibición). El aparte afectado puede no regir tal como está escrito: lee la sentencia citada.`,
    )
  }
  for (const doc of documentosRemitidos(texto)) {
    avisos.push(
      `Este artículo remite a un documento externo: «${doc}». Esta herramienta NO lo consulta —no está en ninguna ` +
        `de sus fuentes—, así que la regla que ese documento fija no puede leerse aquí. Búscalo aparte antes de ` +
        `concluir que el artículo no dice nada sobre el punto.`,
    )
  }
  const erratas = ERRATAS_VERIFICADAS.filter((e) => texto.includes(e))
  if (erratas.length) {
    avisos.push(
      `El texto se transcribe literalmente, tal como lo publica la fuente, sin corregir sus erratas ` +
        `(aparece ${erratas.map((e) => `«${e}»`).join(', ')}): si lo citas, cítalo así o advierte la errata.`,
    )
  }
  return avisos
}
