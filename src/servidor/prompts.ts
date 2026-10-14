import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

/** Los prompts del servidor: aparecen como comandos en Claude Desktop. */
export function registrarPrompts(server: McpServer): void {
  server.registerPrompt(
    'normas-sobre',
    {
      title: '¿Qué normas aplican sobre un tema?',
      description: 'Busca la normativa aplicable a un tema y explica por qué aplica cada una.',
      argsSchema: { tema: z.string() },
    },
    ({ tema }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `¿Qué normas del sector público colombiano aplican sobre "${tema}"? Usa buscar_por_tema, y para las más ` +
              `relevantes usa explicar_relacion_tema para decirme por qué aplican. Cita siempre con enlace.`,
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'sigue-vigente',
    {
      title: '¿Esta norma sigue vigente?',
      description: 'Revisa el texto en busca de derogatorias y modificaciones.',
      argsSchema: { norma: z.string() },
    },
    ({ norma }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `¿"${norma}" sigue vigente? Consúltala con consultar_vigencia (estado con nivel de confianza) y, para ` +
              `las marcas de derogatorias y modificaciones, revisa el texto con obtener_documento con fuente="gestor" ` +
              `buscando "derogad" y "modificado por", o el historial con historial_norma. Dime qué encontraste y ` +
              `advierte con claridad si no puedes confirmarlo: el Gestor no tiene un campo de vigencia.`,
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'explicar-sencillo',
    {
      title: 'Explícame esta norma en lenguaje sencillo',
      description: 'Resume una norma sin jerga, para cualquier persona.',
      argsSchema: { norma: z.string() },
    },
    ({ norma }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Explícame "${norma}" en lenguaje sencillo, sin jerga jurídica: qué regula, a quién aplica y qué obliga. ` +
              `Consúltala primero con resolver_cita y cita los artículos con su enlace.`,
          },
        },
      ],
    }),
  )

  server.registerPrompt(
    'comparar-normas',
    {
      title: 'Compara dos normas',
      description: 'Contrasta el alcance de dos normas.',
      argsSchema: { primera: z.string(), segunda: z.string() },
    },
    ({ primera, segunda }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Compara "${primera}" y "${segunda}": qué regula cada una, en qué se solapan y en qué se contradicen. Consulta ambas y cita con enlaces.`,
          },
        },
      ],
    }),
  )

  // Idea 9 — aclarar la consulta antes de buscar, para no elegir una norma
  // ambigua ni consultar fuentes de más. Es texto que guía al modelo.
  server.registerPrompt(
    'aclarar-consulta',
    {
      title: 'Aclarar una consulta ambigua',
      description: 'Haz las preguntas precisas antes de consultar una norma.',
      argsSchema: { consulta: z.string() },
    },
    ({ consulta }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Antes de responder a "${consulta}", si falta algún dato, pregunta lo siguiente:\n` +
              `1. ¿Qué año de la norma necesitas? (el número solo no identifica la norma: "Decreto 1072" son varios)\n` +
              `2. ¿Qué jurisdicción aplica? (nacional, sectorial, de una alta corte…)\n` +
              `3. ¿Qué sector o entidad está involucrado?\n` +
              `4. ¿Buscas texto, vigencia, historial o jurisprudencia?\n` +
              `5. ¿Necesitas la norma completa o solo un artículo?\n` +
              `Haz solo las preguntas que falten; no repitas las que ya estén respondidas. Luego consulta con las herramientas de este MCP.`,
          },
        },
      ],
    }),
  )
}
